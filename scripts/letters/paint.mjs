/* LETR: paints one picture of a plan with Canvas 2D: shadow, 3D extrusion, outlines, fill, texture, shine, effects, dissolve.
   Works on any 2D context (HTMLCanvas, OffscreenCanvas). Everything is drawn from outlines at the final pixel size. */
import { bbox, crackLines } from "./geom.mjs";
import { rng } from "./rng.mjs";
import { pictureGeometry, settleCenter, CRACK_W, crackSeed } from "./shape.mjs";
import { paintShards, SHARD_MARGIN } from "./shards.mjs";

export const MAX_SIDE = 2048;

function path(ctx, cs, S, ox, oy) {
  for ( const c of cs ) {
    ctx.moveTo(ox + c[0] * S, oy + c[1] * S);
    for ( let i = 2; i < c.length; i += 2 ) ctx.lineTo(ox + c[i] * S, oy + c[i + 1] * S);
    ctx.closePath();
  }
}

const signedArea = (c) => { let a = 0; for ( let i = 0, n = c.length; i < n; i += 2 ) { const j = (i + 2) % n; a += c[i] * c[j + 1] - c[j] * c[i + 1]; } return a / 2; };

/* colour helpers */
export function hexToHsl(h) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(h).trim());
  if ( !m ) return [0, 0, 50];
  const r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let hh = 0, s = 0;
  if ( mx !== mn ) {
    const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh *= 60;
  }
  return [hh, s * 100, l * 100];
}
const hsl = (h, s, l, a = 1) => `hsla(${((h % 360) + 360) % 360},${Math.max(0, Math.min(100, s)).toFixed(0)}%,${Math.max(0, Math.min(100, l)).toFixed(0)}%,${a})`;
const rot = (hex, dh, dl = 0) => { const [h, s, l] = hexToHsl(hex); return hsl(h + dh, s, l + dl); };

/* the extents (word units) a picture needs around its letters */
function extents(plan, geo, p, back) {
  const H = plan.hand, b = bbox(geo.flatMap((l) => l.cs));
  const outer = H.inflate + H.inkW + H.out2W + 0.05;
  const dx = Math.cos(H.depthAng) * H.depth, dy = Math.sin(H.depthAng) * H.depth;
  const sx = H.shadow ? Math.cos(H.shadow.ang) * H.shadow.d : 0, sy = H.shadow ? Math.sin(H.shadow.ang) * H.shadow.d : 0;
  let x0 = b.x0 - outer + Math.min(0, dx, dx + sx), x1 = b.x1 + outer + Math.max(0, dx, dx + sx);
  let y0 = b.y0 - outer + Math.min(0, dy, dy + sy), y1 = b.y1 + outer + Math.max(0, dy, dy + sy);
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  if ( back ) { const m = H.inkW * 2 + 0.06 + (H.shadow ? H.shadow.d : 0); x0 = Math.min(x0, back.box.x0 - m); y0 = Math.min(y0, back.box.y0 - m); x1 = Math.max(x1, back.box.x1 + m); y1 = Math.max(y1, back.box.y1 + m); }
  for ( const f of p.fx ) {
    const m = { krackle: 0.55, burst: 0.42, puff: 0.5, debris: 0.9, sparks: 0.45, embers: 0.6, rays: 0.5, droplets: 0.5, dust: 0.45 }[f.k];
    if ( m ) { x0 = Math.min(x0, b.x0 - m * Math.max(1, h)); x1 = Math.max(x1, b.x1 + m * Math.max(1, h)); y0 = Math.min(y0, b.y0 - m * Math.max(1, h) * (f.k === "embers" ? 1.6 : 1)); y1 = Math.max(y1, b.y1 + m * Math.max(1, h) * (f.k === "embers" ? 0.3 : 1)); }
    if ( f.k === "speed" ) { const L = Math.min(2.4, 0.6 + w * 0.5); if ( (f.dir ?? 1) > 0 ) x0 = Math.min(x0, b.x0 - L); else x1 = Math.max(x1, b.x1 + L); }
    if ( f.k === "swirl" ) for ( const [x, y] of swirlPoints(plan, f) ) { x0 = Math.min(x0, x - 0.1); x1 = Math.max(x1, x + 0.1); y0 = Math.min(y0, y - 0.1); y1 = Math.max(y1, y + 0.1); }
  }
  /* LM: a smear frame's multiples (offset by dx/dy and zoomed toward the reader) are inside the picture, not cut at its edge */
  if ( p.smear ) {
    const z = Math.max(0, p.smear.zoom ?? 0), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, sdx = p.smear.dx ?? 0, sdy = p.smear.dy ?? 0;
    const hw = (w / 2 + outer) * (1 + z), hh = (h / 2 + outer) * (1 + z);
    x0 = Math.min(x0, cx + Math.min(0, sdx) - hw); x1 = Math.max(x1, cx + Math.max(0, sdx) + hw);
    y0 = Math.min(y0, cy + Math.min(0, sdy) - hh); y1 = Math.max(y1, cy + Math.max(0, sdy) + hh);
  }
  return { x0, y0, x1, y1, b };
}

/* fill paint for the whole word or one letter box */
function fillPaint(ctx, H, kind, box, S, ox, oy, i, n) {
  const F = H.pal.fill;
  const X0 = ox + box.x0 * S, X1 = ox + box.x1 * S, Y0 = oy + box.y0 * S, Y1 = oy + box.y1 * S;
  let g;
  switch ( kind ) {
    case "flat": return F[1];
    case "split": g = ctx.createLinearGradient(0, Y0, 0, Y1); g.addColorStop(0, F[0]); g.addColorStop(0.5, F[0]); g.addColorStop(0.5001, F[1]); g.addColorStop(1, F[2]); return g;
    case "hgrad": g = ctx.createLinearGradient(X0, Y0, X1, Y1 * 0.2 + Y0 * 0.8); g.addColorStop(0, F[0]); g.addColorStop(0.45, F[1]); g.addColorStop(1, F[2]); return g;
    case "radial": { const cx = (X0 + X1) / 2, cy = (Y0 + Y1) / 2, r = Math.max(X1 - X0, Y1 - Y0) * 0.6; g = ctx.createRadialGradient(cx, cy, r * 0.05, cx, cy, r); g.addColorStop(0, F[0]); g.addColorStop(0.45, F[1]); g.addColorStop(1, F[2]); return g; }
    case "letters": {
      const dh = (n > 1 ? (i / (n - 1) - 0.5) : 0) * 70;
      g = ctx.createLinearGradient(0, Y0, 0, Y1); g.addColorStop(0, rot(F[0], dh)); g.addColorStop(0.55, rot(F[1], dh)); g.addColorStop(1, rot(F[2], dh)); return g;
    }
    case "alt": {   /* LOOK: deliberate per-letter colours, each letter its own colour with a light top */
      const c = (H.alt ?? F)[Math.max(0, i) % (H.alt ?? F).length];
      g = ctx.createLinearGradient(0, Y0, 0, Y1); g.addColorStop(0, rot(c, 0, 22)); g.addColorStop(0.5, c); g.addColorStop(1, rot(c, 0, -14)); return g;
    }
    case "multi": {   /* LOOK: more than three stops: a sunset down the letters, or a hue sweep across the word */
      if ( H.multi === "sweep" ) {
        g = ctx.createLinearGradient(X0, 0, X1, 0);
        [0, 0.2, 0.4, 0.6, 0.8, 1].forEach((t, k) => g.addColorStop(t, rot(F[1], -50 + 20 * k, k % 2 ? 6 : -2)));
        return g;
      }
      g = ctx.createLinearGradient(0, Y0, 0, Y1);
      g.addColorStop(0, F[0]); g.addColorStop(0.28, rot(F[0], 18, -6)); g.addColorStop(0.5, F[1]); g.addColorStop(0.72, rot(F[1], -22, -8)); g.addColorStop(1, F[2]);
      return g;
    }
    case "hollow": return H.hollowPaper ?? "#fffdf2";
    default: g = ctx.createLinearGradient(0, Y0, 0, Y1); g.addColorStop(0, F[0]); g.addColorStop(0.55, F[1]); g.addColorStop(1, F[2]); return g;
  }
}

function texture(ctx, plan, kind, box, S, ox, oy, seed, letters) {
  const H = plan.hand, R = rng(seed >>> 0);
  const X0 = ox + box.x0 * S, X1 = ox + box.x1 * S, Y0 = oy + box.y0 * S, Y1 = oy + box.y1 * S;
  /* LOOK: small lettering stays clean: below about 40 px of cap height a texture inside the strokes is only grain that muddies the
     letter (a letterer leaves it out at that size); cracks stay (the reader counted them in), halftone keeps its own minimum cell */
  if ( S < 40 && kind !== "cracks" && kind !== "halftone" ) return;
  ctx.save();
  switch ( kind ) {
    case "halftone": {
      const cell = Math.max(3.2, S * 0.075);
      ctx.fillStyle = H.pal.fill[2]; ctx.globalAlpha = 0.55;
      ctx.beginPath();
      for ( let y = Y0, row = 0; y < Y1 + cell; y += cell * 0.86, row++ ) for ( let x = X0 + (row % 2) * cell / 2; x < X1 + cell; x += cell ) {
        const t = (y - Y0) / Math.max(1, Y1 - Y0), r = cell * 0.48 * Math.max(0, t - 0.25) / 0.75;
        if ( r > 0.4 ) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832); }
      }
      ctx.fill();
      break;
    }
    case "speckle": {
      /* LOOK: fewer, firmer specks (a spatter, not sensor noise) */
      const n = Math.min(220, Math.round((X1 - X0) * (Y1 - Y0) / Math.max(60, S * S * 0.03)));
      for ( let k = 0; k < n; k++ ) {
        ctx.fillStyle = R.chance(0.6) ? H.pal.fill[2] : H.pal.fill[0]; ctx.globalAlpha = R.f(0.5, 0.85);
        const r = R.f(0.012, 0.03) * S; ctx.beginPath(); ctx.arc(R.f(X0, X1), R.f(Y0, Y1), Math.max(1.1, r), 0, 6.2832); ctx.fill();
      }
      break;
    }
    case "cracks": {
      /* LOOK: cracks start on a letter's edge and run a little way in (geom.crackLines, the same lines the legibility check reads),
         an ink line with a light edge beside it; they no longer cross a letter (a crack down an S made it a $) */
      ctx.lineJoin = "miter"; ctx.lineCap = "round";
      for ( const l of letters ?? [] ) {
        const lb = bbox(l.cs), h = Math.max(0.1, lb.y1 - lb.y0);
        const lines = crackLines(l.cs, crackSeed(plan, l.i), H.crackN ?? 2);
        for ( const [col, w, dx] of [[H.pal.fill[0], 0.6, 0.012], [H.ink, 1, 0]] ) {
          ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, CRACK_W * h * S * w); ctx.beginPath();
          for ( const ln of lines ) { ctx.moveTo(ox + (ln[0] + dx * h) * S, oy + (ln[1] + dx * h) * S); for ( let q = 2; q < ln.length; q += 2 ) ctx.lineTo(ox + (ln[q] + dx * h) * S, oy + (ln[q + 1] + dx * h) * S); }
          ctx.stroke();
        }
      }
      break;
    }
    case "brush": {   /* LOOK: brush hatching inside the letters: tapered strokes in the dark of the palette, a few light ones */
      const a = H.brushAng ?? -1, ca = Math.cos(a), sa = Math.sin(a), gap = Math.max(3, S * 0.1);
      for ( let t = -(Y1 - Y0) - (X1 - X0); t < (X1 - X0) + (Y1 - Y0); t += gap * R.f(0.8, 1.3) ) {
        const len = S * R.f(0.25, 0.6), w = Math.max(1, S * R.f(0.025, 0.055));
        const px = X0 + (X1 - X0) / 2 + t * -sa + R.f(-0.3, 0.3) * len * ca, py = Y0 + (Y1 - Y0) / 2 + t * ca + R.f(-1, 1) * (Y1 - Y0) * 0.4;
        const light = R.chance(0.22);
        ctx.fillStyle = light ? H.pal.fill[0] : H.pal.fill[2]; ctx.globalAlpha = light ? 0.75 : 0.8;
        ctx.beginPath(); ctx.moveTo(px - ca * len / 2, py - sa * len / 2);
        ctx.quadraticCurveTo(px - sa * w, py + ca * w, px + ca * len / 2, py + sa * len / 2);
        ctx.quadraticCurveTo(px + sa * w * 0.4, py - ca * w * 0.4, px - ca * len / 2, py - sa * len / 2); ctx.fill();
      }
      break;
    }
    case "burstlines": {   /* LOOK: light rays bursting inside the letters from a point low in the word */
      const cx = (X0 + X1) / 2 + R.f(-0.15, 0.15) * (X1 - X0), cy = Y1 - (Y1 - Y0) * R.f(0.15, 0.4), r = Math.hypot(X1 - X0, Y1 - Y0);
      const n = R.i(20, 30), r0 = (Y1 - Y0) * 0.12;
      ctx.fillStyle = H.pal.fill[0]; ctx.globalAlpha = 0.85;
      ctx.beginPath();
      for ( let k = 0; k < n; k++ ) { const a = (k / n) * 6.2832 + R.f(-0.05, 0.05), w = R.f(0.02, 0.05); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a - w) * r, cy + Math.sin(a - w) * r); ctx.lineTo(cx + Math.cos(a + w) * r, cy + Math.sin(a + w) * r); ctx.closePath(); }
      ctx.fill();
      break;
    }
    case "spots": {   /* LOOK: polka spots */
      const cell = Math.max(5, S * 0.24);
      ctx.fillStyle = H.pal.fill[2]; ctx.globalAlpha = 0.9; ctx.beginPath();
      for ( let y = Y0, row = 0; y < Y1 + cell; y += cell * 0.87, row++ ) for ( let x = X0 + (row % 2) * cell / 2; x < X1 + cell; x += cell ) {
        if ( R.chance(0.25) ) continue;
        const r = cell * R.f(0.17, 0.3), px = x + R.f(-0.2, 0.2) * cell, py = y + R.f(-0.2, 0.2) * cell;
        ctx.moveTo(px + r, py); ctx.arc(px, py, r, 0, 6.2832);
      }
      ctx.fill();
      break;
    }
    case "speed": {
      ctx.strokeStyle = H.pal.fill[0]; ctx.globalAlpha = 0.75; ctx.lineCap = "round";
      for ( let y = Y0 + S * 0.08; y < Y1; y += S * R.f(0.09, 0.16) ) { ctx.lineWidth = Math.max(1, S * R.f(0.012, 0.03)); const a = R.f(X0, X1), b = a + (X1 - X0) * R.f(0.2, 0.6); ctx.beginPath(); ctx.moveTo(a, y); ctx.lineTo(b, y); ctx.stroke(); }
      break;
    }
    case "rays": {
      const cx = (X0 + X1) / 2, cy = Y1 + (Y1 - Y0) * 0.3, r = Math.hypot(X1 - X0, Y1 - Y0);
      ctx.fillStyle = H.pal.fill[0]; ctx.globalAlpha = 0.45;
      for ( let a = -Math.PI; a < 0; a += 0.16 ) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.lineTo(cx + Math.cos(a + 0.06) * r, cy + Math.sin(a + 0.06) * r); ctx.fill(); }
      break;
    }
    default: break;
  }
  ctx.restore();
}

/* swirl: arcs along the circle a bent (orbiting) word lies on, trailing behind it (the word's own centre is the picture's origin) */
function swirlGeom(plan, f) {
  const c = plan._center ?? [plan.layout.W / 2, -0.5], W = plan.layout.W, R0 = f.R0, dir = f.dir;
  const cx = W / 2 - c[0], cy = -0.5 + R0 - c[1], r = Math.abs(R0);
  const thL = dir > 0 ? -Math.PI / 2 - W / (2 * R0) : Math.PI / 2 + W / (2 * Math.abs(R0));   // the word's back end
  const span = Math.min(1.4, 2.2 / Math.max(0.6, r));                                             // about 2.2 cap heights of trail
  return { cx, cy, r, thL, span, back: dir > 0 ? -1 : 1 };
}
function swirlPoints(plan, f) {
  const g = swirlGeom(plan, f), pts = [];
  for ( const dr of [-0.5, 0.5] ) for ( let k = 0; k <= 6; k++ ) { const a = g.thL + g.back * g.span * (k / 6) - g.back * 0.15; pts.push([g.cx + Math.cos(a) * (g.r + dr), g.cy + Math.sin(a) * (g.r + dr)]); }
  return pts;
}

function effect(ctx, plan, f, wb, S, ox, oy, behind) {
  const H = plan.hand, R = rng(f.seed >>> 0);
  const cx = ox + (wb.x0 + wb.x1) / 2 * S, cy = oy + (wb.y0 + wb.y1) / 2 * S;
  const hw = (wb.x1 - wb.x0) / 2 * S, hh = (wb.y1 - wb.y0) / 2 * S;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, f.a ?? 1));
  switch ( f.k ) {
    case "burst": if ( !behind ) break; {
      const n = R.i(14, 22);
      for ( let k = 0; k < n; k++ ) {
        const a = (k / n) * 6.2832 + R.f(-0.12, 0.12), r1 = 1.02 + R.f(0, 0.15), r2 = r1 + R.f(0.25, 0.6);
        const w = R.f(0.02, 0.05) * S;
        const ex = Math.cos(a), ey = Math.sin(a), px = -ey, py = ex;
        const x1 = cx + ex * (hw + S * 0.12) * r1, y1 = cy + ey * (hh + S * 0.12) * r1, x2 = cx + ex * (hw + S * 0.12) * r2, y2 = cy + ey * (hh + S * 0.12) * r2;
        ctx.fillStyle = H.ink; ctx.beginPath(); ctx.moveTo(x1 + px * w, y1 + py * w); ctx.lineTo(x2, y2); ctx.lineTo(x1 - px * w, y1 - py * w); ctx.fill();
      }
      break;
    }
    case "krackle": if ( !behind ) break; {
      /* Kirby krackle: clusters of black blobs in a halo of energy colour (cosmic power) */
      const n = R.i(8, 13);
      for ( let k = 0; k < n; k++ ) {
        const a = R.f(0, 6.2832), d = R.f(0.95, 1.35), x0 = cx + Math.cos(a) * (hw + S * 0.15) * d, y0 = cy + Math.sin(a) * (hh + S * 0.15) * d;
        const m = R.i(3, 6), r0 = S * R.f(0.05, 0.11);
        ctx.fillStyle = H.pal.fill[0];
        for ( let j = 0; j < m; j++ ) { ctx.beginPath(); ctx.arc(x0 + R.f(-1, 1) * r0 * 1.6, y0 + R.f(-1, 1) * r0 * 1.6, r0 * R.f(0.5, 1) * 1.45, 0, 6.2832); ctx.fill(); }
        ctx.fillStyle = H.ink;
        for ( let j = 0; j < m; j++ ) { ctx.beginPath(); ctx.arc(x0 + R.f(-1, 1) * r0 * 1.6, y0 + R.f(-1, 1) * r0 * 1.6, r0 * R.f(0.35, 1), 0, 6.2832); ctx.fill(); }
      }
      break;
    }
    case "speed": if ( !behind ) break; if ( f.radial ) {
      /* zoom lines out of the word: the word comes at the reader */
      const n = R.i(22, 34); ctx.strokeStyle = H.ink; ctx.lineCap = "round";
      for ( let k = 0; k < n; k++ ) { const a = (k / n) * 6.2832 + R.f(-0.08, 0.08), r1 = R.f(0.75, 0.95), r2 = r1 + R.f(0.3, 0.7); ctx.lineWidth = Math.max(1, S * R.f(0.012, 0.035)); ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * hw * r1, cy + Math.sin(a) * hh * r1); ctx.lineTo(cx + Math.cos(a) * hw * r2, cy + Math.sin(a) * hh * r2); ctx.stroke(); }
      break;
    } else {
      const dir = f.dir ?? 1, L = Math.min(2.4, 0.6 + (wb.x1 - wb.x0) * 0.5) * S;
      ctx.lineCap = "round";
      for ( let y = oy + wb.y0 * S; y < oy + wb.y1 * S; y += S * R.f(0.07, 0.15) ) {
        const xs = dir > 0 ? ox + wb.x0 * S + S * 0.3 : ox + wb.x1 * S - S * 0.3, len = L * R.f(0.4, 1);
        ctx.strokeStyle = R.chance(0.7) ? H.ink : H.pal.fill[0]; ctx.lineWidth = Math.max(1, S * R.f(0.015, 0.04));
        ctx.beginPath(); ctx.moveTo(xs, y); ctx.lineTo(xs - dir * len, y); ctx.stroke();
      }
      break;
    }
    case "swirl": if ( !behind ) break; {
      const g = swirlGeom(plan, f), n = R.i(3, 4);
      ctx.lineCap = "round";
      for ( let k = 0; k < n; k++ ) {
        const r = (g.r + R.f(-0.42, 0.42)) * S, len = g.span * R.f(0.45, 1), a0 = g.thL - g.back * R.f(0.05, 0.25);
        const a1 = a0 + g.back * len;
        const lo = Math.min(a0, a1), hi = Math.max(a0, a1), cx = ox + g.cx * S, cy = oy + g.cy * S;
        ctx.strokeStyle = H.ink; ctx.lineWidth = Math.max(1.5, S * R.f(0.05, 0.08)); ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, r), lo, hi); ctx.stroke();
        ctx.strokeStyle = H.pal.fill[0]; ctx.lineWidth = Math.max(1, S * R.f(0.02, 0.035)); ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, r), lo + (g.back < 0 ? 0 : 0.04), hi - (g.back < 0 ? 0.04 : 0)); ctx.stroke();
      }
      break;
    }
    case "puff": if ( behind ) break; {
      const n = R.i(9, 13), t = f.t ?? 0.5;
      for ( let k = 0; k < n; k++ ) {
        const a = (k / n) * 6.2832 + R.f(-0.2, 0.2), d = 0.75 + t * 0.55;
        const x = cx + Math.cos(a) * hw * d, y = cy + Math.sin(a) * hh * d * 1.3, r = S * R.f(0.18, 0.32) * (1.2 - t * 0.5);
        ctx.fillStyle = "#ffffff"; ctx.strokeStyle = H.ink; ctx.lineWidth = Math.max(1, S * 0.03);
        ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); ctx.stroke();
      }
      break;
    }
    case "debris": if ( behind ) break; {
      const n = R.i(8, 14), t = f.t ?? 0.5;
      for ( let k = 0; k < n; k++ ) {
        const a = R.f(0, 6.2832), d = 0.6 + t * R.f(0.7, 1.5);
        const x = cx + Math.cos(a) * hw * d, y = cy + Math.sin(a) * hh * d + t * t * S * 0.5, r = S * R.f(0.05, 0.12) * (1.1 - t * 0.4), q = R.f(0, 6.28);
        ctx.fillStyle = R.pick(H.pal.fill); ctx.strokeStyle = H.ink; ctx.lineWidth = Math.max(1, S * 0.022); ctx.lineJoin = "miter";
        ctx.beginPath(); ctx.moveTo(x + Math.cos(q) * r, y + Math.sin(q) * r); ctx.lineTo(x + Math.cos(q + 2.3) * r * 0.8, y + Math.sin(q + 2.3) * r * 0.8); ctx.lineTo(x + Math.cos(q + 4.1) * r * 0.6, y + Math.sin(q + 4.1) * r * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      break;
    }
    case "dust": if ( behind ) break; {
      const n = R.i(6, 9), by = oy + wb.y1 * S;
      for ( let k = 0; k < n; k++ ) {
        const x = ox + (wb.x0 + (wb.x1 - wb.x0) * (k + R.f(0, 1)) / n) * S, r = S * R.f(0.12, 0.24);
        ctx.fillStyle = "#e8e2d6"; ctx.strokeStyle = H.ink; ctx.lineWidth = Math.max(1, S * 0.025);
        ctx.beginPath(); ctx.arc(x, by - r * 0.3, r, 0, 6.2832); ctx.fill(); ctx.stroke();
      }
      break;
    }
    case "sparks": if ( !behind ) break; {
      const n = R.i(5, 8);
      for ( let k = 0; k < n; k++ ) {
        const a = R.f(0, 6.2832); let x = cx + Math.cos(a) * hw * 0.95, y = cy + Math.sin(a) * hh * 0.95;
        ctx.beginPath(); ctx.moveTo(x, y);
        for ( let s = 0; s < 4; s++ ) { x += Math.cos(a + R.f(-0.8, 0.8)) * S * 0.12; y += Math.sin(a + R.f(-0.8, 0.8)) * S * 0.12; ctx.lineTo(x, y); }
        ctx.lineJoin = "miter"; ctx.strokeStyle = H.ink; ctx.lineWidth = Math.max(2, S * 0.06); ctx.stroke();
        ctx.strokeStyle = H.pal.fill[0]; ctx.lineWidth = Math.max(1, S * 0.03); ctx.stroke();
      }
      break;
    }
    case "embers": if ( behind ) break; {
      const n = R.i(6, 11);
      for ( let k = 0; k < n; k++ ) {
        const x = ox + (wb.x0 + R.f(0, 1) * (wb.x1 - wb.x0)) * S, y = oy + wb.y0 * S - R.f(0.05, 1.3) * S, r = S * R.f(0.025, 0.06);
        ctx.fillStyle = R.pick(["#fff3a0", "#ffb020", "#ff6a1a"]); ctx.strokeStyle = H.ink; ctx.lineWidth = Math.max(1, S * 0.015);
        ctx.beginPath(); ctx.moveTo(x, y - r * 2.2); ctx.quadraticCurveTo(x + r * 1.2, y, x, y + r); ctx.quadraticCurveTo(x - r * 1.2, y, x, y - r * 2.2); ctx.fill(); ctx.stroke();
      }
      break;
    }
    case "droplets": if ( behind ) break; {
      const n = R.i(6, 10);
      for ( let k = 0; k < n; k++ ) {
        const a = R.f(Math.PI * 1.05, Math.PI * 1.95), d = R.f(1, 1.4), x = cx + Math.cos(a) * hw * d, y = cy + Math.sin(a) * hh * d * 1.4, r = S * R.f(0.04, 0.08);
        ctx.fillStyle = H.pal.fill[1]; ctx.strokeStyle = H.ink; ctx.lineWidth = Math.max(1, S * 0.02);
        ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); ctx.stroke();
      }
      break;
    }
    case "rays": if ( !behind ) break; {
      const n = 18; ctx.fillStyle = H.pal.fill[0]; ctx.globalAlpha *= 0.5;
      for ( let k = 0; k < n; k++ ) { const a = (k / n) * 6.2832, r = Math.max(hw, hh) * 1.35; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.7); ctx.lineTo(cx + Math.cos(a + 0.12) * r, cy + Math.sin(a + 0.12) * r * 0.7); ctx.fill(); }
      break;
    }
    default: break;
  }
  ctx.restore();
}

/* ---------- LOOK: backdrops (opt-in): a jagged starburst, an explosion cloud, a double-oval balloon, a colour plate ----------
   Shapes in word units around the hold box, made once per plan (from the hand's backSeed), then moved with the picture's own
   transform (scale, squash, tilt, shake) and the timeline's backdrop scale (it pops in with the word and leaves before it). */
function backBase(plan) {
  if ( plan._back !== undefined ) return plan._back;
  const H = plan.hand, hb = plan._holdBox ?? { w: 3, h: 1 };
  let v = null;
  if ( H.back ) {
    const R = rng((H.backSeed ?? plan.seed) >>> 0);
    const rx = hb.w / 2 + 0.3, ry = hb.h / 2 + 0.28;
    const ell = (a, kx = 1, ky = 1) => [Math.cos(a) * rx * kx, Math.sin(a) * ry * ky];
    const nrm = (a) => { const x = Math.cos(a) / rx, y = Math.sin(a) / ry, l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
    v = { kind: H.back, polys: [], circles: [] };
    if ( H.back === "star" ) {
      const n = Math.max(12, Math.min(26, Math.round((rx + ry) * 3.2))), outer = [], inner = [];
      for ( let k = 0; k < n * 2; k++ ) {
        const a = (k / (n * 2)) * 6.2832 + R.f(-0.04, 0.04);
        const [ex, ey] = ell(a), [nx, ny] = nrm(a), L = k % 2 ? R.f(-0.12, 0.02) : R.f(0.4, 0.85);
        outer.push(ex + nx * L, ey + ny * L);
        const Li = k % 2 ? R.f(-0.2, -0.1) : L * 0.55;
        inner.push(ex + nx * Li, ey + ny * Li);
      }
      v.polys = [outer, inner];
    } else if ( H.back === "cloud" ) {
      const per = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry))), n = Math.max(7, Math.round(per / 0.62));
      for ( let k = 0; k < n; k++ ) { const a = (k / n) * 6.2832 + R.f(-0.1, 0.1), [x, y] = ell(a, 0.9, 0.86); v.circles.push([x, y, R.f(0.32, 0.52) * Math.max(0.8, Math.min(1.3, ry))]); }
      const e = []; for ( let k = 0; k < 40; k++ ) { const [x, y] = ell((k / 40) * 6.2832, 0.95, 0.92); e.push(x, y); }
      v.polys = [e];
    } else if ( H.back === "oval" ) {
      const e1 = [], e2 = [], dx = R.f(0.1, 0.18) * R.sign(), dy = R.f(0.08, 0.14);
      for ( let k = 0; k < 48; k++ ) { const a = (k / 48) * 6.2832, [x, y] = ell(a, 1.08, 1.18); e1.push(x, y); e2.push(x * 1.04 + dx, y * 1.06 + dy); }
      v.polys = [e2, e1];
    } else {
      const sk = R.f(0.12, 0.3) * R.sign(), j = () => R.f(-0.07, 0.07);
      const q = [-rx - sk + j(), -ry + j(), rx - sk + j(), -ry + j(), rx + sk + j(), ry + j(), -rx + sk + j(), ry + j()];
      const r = R.f(-0.08, 0.08), c = Math.cos(r), sn = Math.sin(r), rq = []; for ( let i = 0; i < 8; i += 2 ) rq.push(q[i] * c - q[i + 1] * sn, q[i] * sn + q[i + 1] * c);
      const off = rq.map((t, i) => t + (i % 2 ? 0.1 : 0.12));
      v.polys = [off, rq];
    }
    /* colours: a strong ground against the word's own fill */
    const [hh, ss, ll] = hexToHsl(H.pal.fill[1]);
    const light = ll > 55;
    const cands = light ? [hsl(hh + 180, 70, 38), H.pal.ext, "#d8262b", "#1f4fc0", "#1b1020"] : ["#fff3a0", "#ffffff", hsl(hh + 180, 80, 72)];
    v.a = R.pick(cands); v.b = light ? R.pick(["#ffd84a", "#ffffff", hsl(hh + 180, 70, 58)]) : R.pick(["#ffffff", "#ffe98a"]);
    if ( v.a === v.b ) v.b = "#ffffff";
    void ss;
  }
  Object.defineProperty(plan, "_back", { value: v, enumerable: false, configurable: true, writable: true });
  return v;
}
function backdropOf(plan, p) {
  const B = backBase(plan); if ( !B ) return null;
  const k = p.backS ?? 1; if ( k <= 0.02 ) return null;
  const g = p.g, cg = Math.cos(g.r), sg = Math.sin(g.r), R = rng((p.boil || 3) >>> 0), jit = p.boil ? 0.012 : 0;
  const T = (x, y) => { const X = x * g.s * g.sx * k, Y = y * g.s * g.sy * k; return [X * cg - Y * sg + g.x + R.f(-jit, jit), X * sg + Y * cg + g.y + R.f(-jit, jit)]; };
  const polys = B.polys.map((c) => { const o = []; for ( let i = 0; i < c.length; i += 2 ) o.push(...T(c[i], c[i + 1])); return o; });
  const circles = B.circles.map(([x, y, r]) => [...T(x, y), r * g.s * k]);
  const all = [...polys, ...circles.map(([x, y, r]) => [x - r, y - r, x + r, y + r])];
  return { kind: B.kind, a: B.a, b: B.b, polys, circles, box: bbox(all) };
}
function paintBackdrop(ctx, H, bk, S, ox, oy, shadowOnly = false) {
  const P = (c) => { ctx.moveTo(ox + c[0] * S, oy + c[1] * S); for ( let i = 2; i < c.length; i += 2 ) ctx.lineTo(ox + c[i] * S, oy + c[i + 1] * S); ctx.closePath(); };
  const ink = Math.max(1.2, H.inkW * 1.6 * S);
  ctx.save(); ctx.lineJoin = "miter"; ctx.miterLimit = 4;
  if ( shadowOnly ) {
    ctx.beginPath();
    if ( bk.kind === "cloud" ) { for ( const [x, y, r] of bk.circles ) { ctx.moveTo(ox + (x + r) * S, oy + y * S); ctx.arc(ox + x * S, oy + y * S, r * S, 0, 6.2832); } P(bk.polys[0]); }
    else P(bk.polys[0]);
    ctx.fill(); ctx.lineWidth = ink; ctx.stroke(); ctx.restore(); return;
  }
  if ( bk.kind === "star" ) {
    ctx.beginPath(); P(bk.polys[0]); ctx.fillStyle = bk.a; ctx.fill(); ctx.strokeStyle = H.ink; ctx.lineWidth = ink; ctx.stroke();
    ctx.beginPath(); P(bk.polys[1]); ctx.fillStyle = bk.b; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
  } else if ( bk.kind === "cloud" ) {
    const all = () => { ctx.beginPath(); for ( const [x, y, r] of bk.circles ) { ctx.moveTo(ox + (x + r) * S, oy + y * S); ctx.arc(ox + x * S, oy + y * S, r * S, 0, 6.2832); } P(bk.polys[0]); };
    all(); ctx.strokeStyle = H.ink; ctx.lineWidth = ink * 2; ctx.stroke();
    all(); ctx.fillStyle = bk.a; ctx.fill("nonzero");
    ctx.beginPath(); for ( const [x, y, r] of bk.circles ) { const cx = x - r * 0.18, cy = y - r * 0.2, rr = r * 0.62; ctx.moveTo(ox + (cx + rr) * S, oy + cy * S); ctx.arc(ox + cx * S, oy + cy * S, rr * S, 0, 6.2832); }
    ctx.fillStyle = bk.b; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
  } else if ( bk.kind === "oval" ) {
    ctx.beginPath(); P(bk.polys[0]); ctx.fillStyle = bk.a; ctx.fill(); ctx.strokeStyle = H.ink; ctx.lineWidth = ink; ctx.stroke();
    ctx.beginPath(); P(bk.polys[1]); ctx.fillStyle = "#fffdf4"; ctx.fill(); ctx.stroke();
  } else {
    ctx.beginPath(); P(bk.polys[0]); ctx.fillStyle = bk.b; ctx.fill();
    ctx.beginPath(); P(bk.polys[1]); ctx.fillStyle = bk.a; ctx.fill(); ctx.strokeStyle = H.ink; ctx.lineWidth = ink * 0.8; ctx.stroke();
  }
  ctx.restore();
}

/* the impact (flash) frame: one tick of a negative, a black star and the word knocked out in white */
function impactFrame(ctx, plan, all, wb, S, ox, oy, outerW, p, canvas) {
  const H = plan.hand, R = rng((p.boil || 7) >>> 0);
  const cx = ox + (wb.x0 + wb.x1) / 2 * S, cy = oy + (wb.y0 + wb.y1) / 2 * S, hw = (wb.x1 - wb.x0) / 2 * S + S * 0.35, hh = (wb.y1 - wb.y0) / 2 * S + S * 0.35;
  const n = R.i(14, 22);
  ctx.beginPath();
  for ( let k = 0; k < n * 2; k++ ) { const a = (k / (n * 2)) * 6.2832, r = k % 2 ? R.f(0.62, 0.8) : R.f(1.05, 1.32); const x = cx + Math.cos(a) * hw * r, y = cy + Math.sin(a) * hh * r; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.closePath(); ctx.fillStyle = H.ink; ctx.fill();
  ctx.beginPath(); path(ctx, all, S, ox, oy);
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = Math.max(1, (H.inflate + 0.012) * 2 * S); ctx.lineJoin = "round"; ctx.stroke();
  ctx.fillStyle = "#ffffff"; ctx.fill();
  return { canvas, ax: ox, ay: oy, S };
}

/* Paint picture p (an entry of plan.timeline.ent/hold/exit) at S px per cap height. `make(w, h)` returns a fresh canvas.
   Returns { canvas, ax, ay, S }: (ax, ay) = where the word's centre is on the canvas. */
export function paintPicture(plan, bank, p, S, make) {
  settleCenter(plan, bank);
  if ( p.shards ) return paintShardPicture(plan, bank, p, S, make);
  /* small words: outlines in cap units would close the counters (a P turns into a blob below ~40 px), so they thin out with size,
     keeping at least about 1.5 px of ink. Hand-letterers do the same: small lettering gets a lighter line. */
  if ( S < 80 ) {
    const H0 = plan.hand, k = Math.max(0.38, S / 80), ink = Math.max(H0.inkW * k, Math.min(H0.inkW, 1.6 / Math.max(1, S)));
    plan = Object.create(plan, { hand: { value: { ...H0, inkW: ink, out2W: H0.out2W * k, inflate: H0.inflate * Math.max(0.6, k) } } });
  }
  const geo = pictureGeometry(plan, bank, p);
  const back = p.impact ? null : backdropOf(plan, p);
  const ext = extents(plan, geo, p, back);
  let w = (ext.x1 - ext.x0) * S, h = (ext.y1 - ext.y0) * S;
  const k = Math.min(1, MAX_SIDE / Math.max(w, h, 1));
  S *= k; w = Math.ceil(w * k) + 2; h = Math.ceil(h * k) + 2;
  const canvas = make(Math.max(2, w), Math.max(2, h));
  const ctx = canvas.getContext("2d");
  const ox = -ext.x0 * S + 1, oy = -ext.y0 * S + 1;
  const H = plan.hand, all = geo.flatMap((l) => l.cs);
  if ( !all.length ) return { canvas, ax: ox, ay: oy, S };
  const wb = ext.b;
  ctx.lineJoin = H.treat === "bubble" || H.font === "titan" || H.font === "sigmar" ? "round" : "miter";
  ctx.miterLimit = 2.2;
  ctx.lineCap = "round";
  const outerW = H.inflate + H.inkW + H.out2W;

  if ( p.impact ) return impactFrame(ctx, plan, all, wb, S, ox, oy, outerW, p, canvas);
  for ( const f of p.fx ) effect(ctx, plan, f, wb, S, ox, oy, true);
  if ( back ) {
    if ( H.shadow ) { ctx.save(); ctx.translate(Math.cos(H.shadow.ang) * Math.min(0.2, H.shadow.d) * S, Math.sin(H.shadow.ang) * Math.min(0.2, H.shadow.d) * S); ctx.fillStyle = `rgba(14,8,26,${H.shadow.a})`; ctx.strokeStyle = ctx.fillStyle; paintBackdrop(ctx, H, back, S, ox, oy, true); ctx.restore(); }
    paintBackdrop(ctx, H, back, S, ox, oy);
  }

  if ( H.keyline === "union" ) paintUnion(ctx, plan, geo, all, wb, S, ox, oy, canvas, make, p);
  else {
  const silhouette = (dx, dy, width, style) => {
    ctx.save(); ctx.translate(dx * S, dy * S); ctx.beginPath(); path(ctx, all, S, ox, oy);
    ctx.fillStyle = style; ctx.strokeStyle = style; ctx.lineWidth = width * 2 * S; ctx.fill("nonzero"); if ( width > 0 ) ctx.stroke(); ctx.restore();
  };
  /* hard drop shadow */
  const ddx = Math.cos(H.depthAng) * H.depth, ddy = Math.sin(H.depthAng) * H.depth;
  if ( H.shadow ) {
    const sx = Math.cos(H.shadow.ang) * H.shadow.d, sy = Math.sin(H.shadow.ang) * H.shadow.d, col = `rgba(14,8,26,${H.shadow.a})`;
    ctx.save(); ctx.globalAlpha = 1;
    /* one silhouette per position would double the alpha where they overlap: draw opaque to an offscreen layer instead */
    const lay = make(canvas.width, canvas.height), lc = lay.getContext("2d");
    lc.lineJoin = ctx.lineJoin; lc.miterLimit = 2.2;
    const one = (dx, dy) => { lc.save(); lc.translate(dx * S, dy * S); lc.beginPath(); path(lc, all, S, ox, oy); lc.fillStyle = "#0e081a"; lc.strokeStyle = "#0e081a"; lc.lineWidth = (outerW + 0.02) * 2 * S; lc.fill(); lc.stroke(); lc.restore(); };
    if ( H.shadow.long ) { const n = Math.max(3, Math.min(24, Math.ceil(H.shadow.d * S / 2))); for ( let k = 1; k <= n; k++ ) { one(sx * k / n, sy * k / n); if ( H.depth ) one(ddx + sx * k / n, ddy + sy * k / n); } }
    else { one(sx, sy); if ( H.depth ) one(ddx + sx, ddy + sy); }
    if ( H.shadowStyle === "dots" ) {   /* a printed halftone shadow instead of a flat one */
      const cell = Math.max(3, S * 0.06), r = cell * 0.5;
      lc.globalCompositeOperation = "destination-in"; lc.beginPath();
      for ( let y = 0, row = 0; y < lay.height + cell; y += cell * 0.86, row++ ) for ( let x = (row % 2) * cell / 2; x < lay.width + cell; x += cell ) { lc.moveTo(x + r, y); lc.arc(x, y, r, 0, 6.2832); }
      lc.fill();
    }
    ctx.globalAlpha = H.shadowStyle === "dots" ? Math.min(0.85, H.shadow.a + 0.35) : H.shadow.a; ctx.drawImage(lay, 0, 0); ctx.restore();
    lay.width = 0; lay.height = 0;   // FXLE F2: the shadow layer is used once: its backing store goes now, not at the next GC
    void col;
  }
  /* 3D extrusion: inked block behind the letters */
  if ( H.depth > 0 ) {
    const steps = Math.max(2, Math.min(28, Math.ceil(H.depth * S / 1.6)));
    for ( let s = steps; s >= 0; s-- ) silhouette(ddx * s / steps, ddy * s / steps, outerW + 0.03, H.ink);
    const [eh, es, el] = hexToHsl(H.pal.ext);
    for ( let s = steps; s >= 1; s-- ) silhouette(ddx * s / steps, ddy * s / steps, outerW - 0.005, hsl(eh, es, el + 8 * (1 - s / steps)));
    if ( H.hatch ) {   /* ink hatching on the block's sides (the letters cover the front) */
      ctx.save(); ctx.beginPath();
      for ( const k of [1, 0.66, 0.33] ) { ctx.save(); ctx.translate(ddx * k * S, ddy * k * S); path(ctx, all, S, ox, oy); ctx.restore(); }
      ctx.clip(); ctx.strokeStyle = H.ink; ctx.globalAlpha = 0.55; ctx.lineWidth = Math.max(1, S * 0.012);
      const gap = Math.max(3, S * 0.05); ctx.beginPath();
      for ( let x = -canvas.height; x < canvas.width; x += gap ) { ctx.moveTo(x, 0); ctx.lineTo(x + canvas.height, canvas.height); }
      ctx.stroke(); ctx.restore();
    }
  }
  /* smear frame: multiples of the word trailing its motion (or exploding toward the reader with a zoom smear) */
  if ( p.smear ) {
    const sm = p.smear, cxw = (wb.x0 + wb.x1) / 2, cyw = (wb.y0 + wb.y1) / 2;
    for ( let k = sm.n; k >= 1; k-- ) {
      const t = k / sm.n, z = 1 + (sm.zoom ?? 0) * t;
      ctx.save();
      ctx.translate(ox + (cxw + (sm.dx ?? 0) * t) * S, oy + (cyw + (sm.dy ?? 0) * t) * S); ctx.scale(z, z); ctx.translate(-(ox + cxw * S), -(oy + cyw * S));
      ctx.beginPath(); path(ctx, all, S, ox, oy);
      if ( H.style === "invincible" ) {
        /* LM (LOOK's live artefact "large pale rectangles behind the letters"): the Invincible face is one flat pale colour, so its
           multiples were pale slabs (blown up to 1.6x by a loud slam). Here they are ghosts in the block colour, fading with distance,
           each with a thin ink line: they read as motion, never as a plate behind the word */
        ctx.globalAlpha = 0.6 - 0.35 * t; ctx.fillStyle = H.pal.ext ?? H.ink; ctx.fill();
        ctx.globalAlpha = Math.min(1, 0.95 - 0.4 * t); ctx.strokeStyle = H.ink; ctx.lineWidth = Math.max(1, S * 0.016); ctx.stroke();
      } else {
        ctx.fillStyle = k % 2 ? H.pal.fill[0] : H.pal.fill[1]; ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = outerW * 2 * S;
        ctx.fill(); ctx.stroke();
        if ( k === sm.n ) { ctx.strokeStyle = H.ink; ctx.lineWidth = Math.max(1, S * 0.02); ctx.stroke(); }
      }
      ctx.restore();
    }
  }
  /* misregistered colour separations: cyan and magenta plates slipped off the key plate */
  if ( p.misreg > 0 ) {
    const m = p.misreg;
    silhouette(m, -m * 0.35, outerW, "#00aeef");
    silhouette(-m * 0.8, m * 0.45, outerW, "#ec008c");
  }
  /* letters: merged (one silhouette) or stacked (each letter its own sticker, later ones on top) */
  /* LOOK: each letter in front of the one to its right (the letterer's rule): painted right to left */
  const groups = H.stack === "merge" ? [{ i: -1, cs: all }] : (H.order === "left" ? geo.slice().reverse() : geo);
  const perLetter = H.fill === "letters" || H.fill === "alt";
  const n = plan.chars.length;
  const fullBox = { x0: wb.x0, y0: wb.y0, x1: wb.x1, y1: wb.y1 };
  /* LOOK (user, 2026-11-13): the light outline goes round the word as a whole; inside the word a letter's own outline would only
     hide its neighbour, so stacked letters keep just their ink line */
  if ( H.out2W > 0 && groups.length > 1 ) {
    ctx.beginPath(); path(ctx, all, S, ox, oy);
    ctx.strokeStyle = H.outline === "sticker" ? (H.pal.out2 === "#1b1020" ? "#ffffff" : H.pal.out2) : H.pal.out2;
    ctx.lineWidth = outerW * 2 * S; ctx.stroke(); ctx.fillStyle = ctx.strokeStyle; ctx.fill("nonzero");
    if ( H.outline === "sticker" ) { ctx.strokeStyle = H.ink; ctx.save(); ctx.lineWidth = (outerW * 2 + 0.03) * S; ctx.globalCompositeOperation = "destination-over"; ctx.stroke(); ctx.restore(); }
  }
  const passes = (grp) => {
    const box = grp.i < 0 ? fullBox : bbox(grp.cs);
    const pathG = () => { ctx.beginPath(); path(ctx, grp.cs, S, ox, oy); };
    if ( H.out2W > 0 && groups.length === 1 ) {
      pathG(); ctx.strokeStyle = H.outline === "sticker" ? (H.pal.out2 === "#1b1020" ? "#ffffff" : H.pal.out2) : H.pal.out2;
      ctx.lineWidth = outerW * 2 * S; ctx.stroke();
      if ( H.outline === "sticker" ) { ctx.strokeStyle = H.ink; ctx.lineWidth = Math.max(1, S * 0.018); ctx.save(); ctx.lineWidth = (outerW * 2 + 0.03) * S; ctx.globalCompositeOperation = "destination-over"; ctx.stroke(); ctx.restore(); }
    }
    pathG(); ctx.strokeStyle = H.ink; ctx.lineWidth = (H.inflate + H.inkW) * 2 * S; ctx.stroke();
    if ( plan.hollow ) { pathG(); ctx.save(); ctx.globalAlpha = 0.2; ctx.fillStyle = H.pal.fill[1]; ctx.fill(); ctx.restore(); return; }   // MOVE: an echo: the outline only
    const fp = perLetter && grp.i < 0 ? null : fillPaint(ctx, H, H.fill, perLetter ? box : fullBox, S, ox, oy, grp.i, n);
    if ( fp ) {
      pathG(); ctx.fillStyle = fp; ctx.fill();
      if ( H.inflate > 0 ) { ctx.strokeStyle = fp; ctx.lineWidth = H.inflate * 2 * S; ctx.lineJoin = "round"; ctx.stroke(); }
    } else for ( const l of geo ) {
      const b = bbox(l.cs); ctx.beginPath(); path(ctx, l.cs, S, ox, oy);
      const f2 = fillPaint(ctx, H, H.fill, b, S, ox, oy, l.i, n); ctx.fillStyle = f2; ctx.fill();
      if ( H.inflate > 0 ) { ctx.strokeStyle = f2; ctx.lineWidth = H.inflate * 2 * S; ctx.lineJoin = "round"; ctx.stroke(); }
    }
    /* inside the letter: texture, shine, inner line */
    ctx.save(); pathG();
    if ( H.inflate > 0 ) { /* clip includes the inflated rim: approximate by stroking into a mask is costly; clip to the core outline */ }
    ctx.clip();
    if ( H.fill === "hollow" ) { pathG(); ctx.strokeStyle = H.pal.fill[1]; ctx.lineWidth = Math.max(2, (H.rimW ?? 0.09) * 2 * S); ctx.stroke(); }
    else if ( H.tex !== "none" ) texture(ctx, plan, H.tex, box, S, ox, oy, (plan.seed ^ (grp.i + 7) * 40503) >>> 0, grp.i < 0 ? geo : [grp]);
    if ( H.gloss ) {
      const Y0 = oy + box.y0 * S, Y1 = oy + box.y1 * S, g = ctx.createLinearGradient(0, Y0, 0, Y0 + (Y1 - Y0) * 0.5);
      g.addColorStop(0, "rgba(255,255,255,0.55)"); g.addColorStop(1, "rgba(255,255,255,0)"); ctx.fillStyle = g; ctx.fillRect(ox + box.x0 * S - 4, Y0 - 4, (box.x1 - box.x0) * S + 8, (Y1 - Y0) * 0.5 + 4);
    }
    if ( H.bevel ) { ctx.save(); ctx.translate(S * 0.035, S * 0.035); pathG(); ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = S * 0.05; ctx.stroke(); ctx.restore(); ctx.save(); ctx.translate(-S * 0.03, -S * 0.03); pathG(); ctx.strokeStyle = "rgba(10,0,20,0.28)"; ctx.lineWidth = S * 0.05; ctx.stroke(); ctx.restore(); }
    if ( H.outline === "inner" ) { pathG(); ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = Math.max(1.2, S * 0.05); ctx.stroke(); pathG(); ctx.strokeStyle = fp ?? H.pal.fill[1]; ctx.lineWidth = Math.max(0.6, S * 0.022); ctx.stroke(); }
    ctx.restore();
    /* LOOK: counters (the holes of O, A, B, R ...) filled solid black or in a colour */
    if ( H.counters && H.counters !== "none" ) {
      ctx.beginPath(); let any = false;
      for ( const l of grp.i < 0 ? geo : [grp] ) {
        if ( plan.layout.letters[l.i]?.ring ) continue;   // a ring's hole shows the ring it holds
        let big = 0; for ( const c of l.cs ) if ( Math.abs(signedArea(c)) > Math.abs(big) ) big = signedArea(c);
        for ( const c of l.cs ) { const a = signedArea(c); if ( a * big < 0 && Math.abs(a) > 0.004 ) { path(ctx, [c], S, ox, oy); any = true; } }
      }
      if ( any ) { ctx.fillStyle = H.counters === "ink" ? H.ink : (H.counterCol ?? H.pal.fill[2]); ctx.fill("evenodd"); if ( H.counters === "color" ) { ctx.strokeStyle = H.ink; ctx.lineWidth = Math.max(1, H.inkW * S); ctx.stroke(); } }
    }
  };
  for ( const grp of groups ) passes(grp);
  /* LOOK: interlocked rings (design.mjs links a run of round letters): the ring painted under its neighbour is painted again over
     it in the lower half, so one passes through the other: over at the top crossing, under at the bottom one */
  if ( H.stack !== "merge" ) for ( const g of geo ) {
    const j = plan.layout.letters[g.i]?.link; if ( j == null ) continue;
    const other = geo.find((q) => q.i === j); if ( !other ) continue;
    const under = H.order === "left" ? g : other, b = bbox(under.cs), mid = (b.y0 + b.y1) / 2;
    const cy = Math.round(oy + mid * S); ctx.save(); ctx.beginPath(); ctx.rect(0, cy, canvas.width, canvas.height - cy); ctx.clip(); passes(under); ctx.restore();
  }
  }

  for ( const f of p.fx ) effect(ctx, plan, f, wb, S, ox, oy, false);

  /* comic dissolve: a growing halftone eats the picture (no smooth fade) */
  if ( p.dissolve > 0 ) {
    const cell = Math.max(5, S * 0.08), r = cell * 0.78 * Math.min(1, p.dissolve);
    ctx.save(); ctx.globalCompositeOperation = "destination-out"; ctx.fillStyle = "#000"; ctx.beginPath();
    for ( let y = 0, row = 0; y < canvas.height + cell; y += cell * 0.86, row++ ) for ( let x = (row % 2) * cell / 2; x < canvas.width + cell; x += cell ) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832); }
    ctx.fill(); ctx.restore();
  }
  return { canvas, ax: ox, ay: oy, S };
}

/* ---------- LOOK2 (SPEC-LOOK P2-P6, P10, P15; the owner: the outline must never cover the neighbouring letters): the book's ink ----------
   ONE keyline round the whole word, letters that never ink over each other:
   1. the duplicate (P4): one flat copy of all letters at a fixed offset in the one dark colour, with a thin ink rim; for heavy sounds
      the same copy swept into a solid block, still one flat colour (no shading, no soft shadow); never inside a ring's counter (P10);
   2. a smear (P15) is 2-3 thin outline-only echoes in the duplicate colour (no filled copies, no pale slabs);
   3. the keyline: every letter's outline stroked in ink (only its outer half survives: step 4 paints over the inner half);
   4. letters back to front (a prefix behind its body, the left letter in front of the right one, an upper row in front of a lower
      one): each CLIPPED to its own outline: flat face (or an open face: white with a rim in the word's colour, P6), then its own
      ink line inside the clip only. Where a letter lies over another, the only line between them is the front letter's own inner
      line: no letter's outline ever lands on another letter's face;
   5. interlocked rings: the ring under at the top crossing is painted again over the lower half, so they pass through each other.
   Line weights are in cap units with pixel floors (the keyline stays visible at token size). */
const UNION_RIM = 0.6, UNION_INNER = 0.45;
function paintUnion(ctx, plan, geo, all, wb, S, ox, oy, canvas, make, p) {
  const H = plan.hand, Ls = plan.layout.letters, pre = plan.layout.pre ?? 0, vertical = plan.layout.arrange === "vertical";
  const rim = Math.max(1, H.inkW * UNION_RIM * S), inner = Math.max(0.75, H.inkW * UNION_INNER * S);
  const P = (c, cs) => { c.beginPath(); path(c, cs, S, ox, oy); };
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  const isRing = (g) => !!Ls[g.i]?.ring;
  const holesOf = (cs) => { let big = 0; for ( const c of cs ) if ( Math.abs(signedArea(c)) > Math.abs(big) ) big = signedArea(c); return cs.filter((c) => signedArea(c) * big < 0); };
  /* 1. the duplicate / block */
  if ( H.depth > 0 ) {
    const ddx = Math.cos(H.depthAng) * H.depth, ddy = Math.sin(H.depthAng) * H.depth;
    const rings = geo.filter(isRing);
    const lay = rings.length ? make(canvas.width, canvas.height) : null, c = lay ? lay.getContext("2d") : ctx;
    c.save(); c.lineJoin = "round"; c.lineCap = "round";
    const steps = H.block === "heavy" ? Math.max(2, Math.min(28, Math.ceil(H.depth * S / 1.6))) : 1;
    const at = (k, fn) => { c.save(); c.translate(ddx * k / steps * S, ddy * k / steps * S); P(c, all); fn(); c.restore(); };
    c.fillStyle = H.ink; c.strokeStyle = H.ink; c.lineWidth = 2 * rim;
    for ( let k = steps; k >= 1; k-- ) at(k, () => { c.fill("nonzero"); c.stroke(); });
    c.fillStyle = H.pal.ext; c.strokeStyle = H.pal.ext; c.lineWidth = Math.max(1, S * 0.004);
    for ( let k = steps; k >= 1; k-- ) at(k, () => { c.fill("nonzero"); if ( steps > 1 ) c.stroke(); });
    if ( lay ) {
      /* a ring's counter shows the scene, never the copy behind it */
      c.globalCompositeOperation = "destination-out"; c.fillStyle = "#000";
      for ( const g of rings ) { const hs = holesOf(g.cs); if ( hs.length ) { P(c, hs); c.fill("nonzero"); } }
      c.restore(); ctx.drawImage(lay, 0, 0); lay.width = 0; lay.height = 0;
    } else c.restore();
  }
  /* 2. smear echoes */
  if ( p.smear ) {
    const sm = p.smear, n = Math.min(3, sm.n ?? 3), cxw = (wb.x0 + wb.x1) / 2, cyw = (wb.y0 + wb.y1) / 2;
    ctx.save(); ctx.strokeStyle = H.pal.ext ?? H.ink; ctx.lineWidth = Math.max(1, S * 0.02);
    for ( let k = n; k >= 1; k-- ) {
      const t = k / n, z = 1 + (sm.zoom ?? 0) * t;
      ctx.save(); ctx.translate(ox + (cxw + (sm.dx ?? 0) * t) * S, oy + (cyw + (sm.dy ?? 0) * t) * S); ctx.scale(z, z); ctx.translate(-(ox + cxw * S), -(oy + cyw * S));
      P(ctx, all); ctx.stroke(); ctx.restore();
    }
    ctx.restore();
  }
  /* an opt-in light outline (look.outline) round the whole word */
  if ( H.out2W > 0 ) { P(ctx, all); ctx.strokeStyle = H.pal.out2 === "#1b1020" ? "#ffffff" : H.pal.out2; ctx.lineWidth = 2 * (rim + H.out2W * S); ctx.stroke(); }
  /* 3. the keyline round the word */
  P(ctx, all); ctx.strokeStyle = H.ink; ctx.lineWidth = 2 * rim; ctx.stroke();
  /* 4. the letters, back to front, each inside its own outline */
  const n = plan.chars.length, perLetter = H.fill === "letters" || H.fill === "alt", fullBox = { x0: wb.x0, y0: wb.y0, x1: wb.x1, y1: wb.y1 };
  const dirSign = H.order === "right" ? 1 : -1;
  const rank = (g) => (vertical ? -(Ls[g.i]?.row ?? 0) * 1e4 : (g.i < pre ? 0 : 1e4)) + dirSign * g.i;
  const order = geo.slice().sort((a, b) => rank(a) - rank(b));
  const letter = (g) => {
    const hollow = H.fill === "hollow" || (H.hollowPre && g.i < pre);
    ctx.save(); P(ctx, g.cs); ctx.clip("nonzero");
    if ( plan.hollow ) { ctx.globalAlpha = 0.2; ctx.fillStyle = H.pal.fill[1]; P(ctx, g.cs); ctx.fill(); ctx.globalAlpha = 1; }   // MOVE: an echo
    else if ( hollow ) {
      P(ctx, g.cs); ctx.fillStyle = H.hollowPaper ?? "#ffffff"; ctx.fill();
      ctx.strokeStyle = H.pal.fill[1]; ctx.lineWidth = Math.max(2, (H.rimW ?? 0.05) * 2 * S * (Ls[g.i]?.s ?? 1) ** 0.5); ctx.stroke();
    } else {
      P(ctx, g.cs); ctx.fillStyle = fillPaint(ctx, H, H.fill, perLetter ? bbox(g.cs) : fullBox, S, ox, oy, g.i, n); ctx.fill();
      if ( H.tex && H.tex !== "none" ) texture(ctx, plan, H.tex, bbox(g.cs), S, ox, oy, (plan.seed ^ (g.i + 7) * 40503) >>> 0, [g]);
    }
    if ( H.join !== "merge" || hollow ) { P(ctx, g.cs); ctx.strokeStyle = H.ink; ctx.lineWidth = 2 * inner; ctx.stroke(); }
    ctx.restore();
  };
  for ( const g of order ) letter(g);
  /* 5. interlocked rings: over at the top crossing, under at the bottom one */
  for ( const g of geo ) {
    const j = Ls[g.i]?.link; if ( j == null ) continue;
    const other = geo.find((q) => q.i === j); if ( !other ) continue;
    const under = rank(g) < rank(other) ? g : other, b = bbox(under.cs), cy = Math.round(oy + (b.y0 + b.y1) / 2 * S);
    ctx.save(); ctx.beginPath(); ctx.rect(0, cy, canvas.width, canvas.height - cy); ctx.clip(); letter(under); ctx.restore();
  }
}

/* a shards exit picture (shards.mjs): the word painted once at rest (cached per scale on the plan), then cut and thrown */
function paintShardPicture(plan, bank, p, S, make) {
  const rest = { ...plan.timeline.hold[0], g: { x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1 }, fx: [], dissolve: 0, smear: null, impact: false, shards: null, reseed: false, boil: p.boil, misreg: 0 };
  rest.letters = rest.letters.map((l) => ({ ...l, x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1, v: 1, ch: undefined }));
  /* the word at rest, painted for this drawing and freed after it (F2: no canvas outlives its picture; 7 drawings per exit) */
  const src = paintPicture(plan, bank, rest, S, make);
  const geo = pictureGeometry(plan, bank, rest);
  const b = bbox(geo.flatMap((l) => l.cs));
  const M = SHARD_MARGIN;
  let x0 = b.x0 - M.x, x1 = b.x1 + M.x, y0 = b.y0 - M.up, y1 = b.y1 + M.down;
  /* the rest picture's own reach (shadow, 3D) must fit too */
  x0 = Math.min(x0, -src.ax / src.S); y0 = Math.min(y0, -src.ay / src.S); x1 = Math.max(x1, (src.canvas.width - src.ax) / src.S); y1 = Math.max(y1, (src.canvas.height - src.ay) / src.S);
  let w = (x1 - x0) * S, h = (y1 - y0) * S;
  const k = Math.min(1, MAX_SIDE / Math.max(w, h, 1));
  /* over the side cap: draw smaller (the rest picture is scaled with it) */
  const Sd = S * k; w = Math.ceil(w * k) + 2; h = Math.ceil(h * k) + 2;
  const canvas = make(Math.max(2, w), Math.max(2, h)), ctx = canvas.getContext("2d");
  const ox = -x0 * Sd + 1, oy = -y0 * Sd + 1;
  if ( k < 1 ) { ctx.save(); ctx.translate(ox, oy); ctx.scale(k, k); ctx.translate(-ox, -oy); }
  paintShards(ctx, plan, p, geo, src, S, ox, oy, path);
  for ( const f of p.fx ?? [] ) effect(ctx, plan, f, b, S, ox, oy, false);
  if ( k < 1 ) ctx.restore();
  if ( p.dissolve > 0 ) {
    const cell = Math.max(5, Sd * 0.08), r = cell * 0.78 * Math.min(1, p.dissolve);
    ctx.save(); ctx.globalCompositeOperation = "destination-out"; ctx.fillStyle = "#000"; ctx.beginPath();
    for ( let y = 0, row = 0; y < canvas.height + cell; y += cell * 0.86, row++ ) for ( let x = (row % 2) * cell / 2; x < canvas.width + cell; x += cell ) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832); }
    ctx.fill(); ctx.restore();
  }
  src.canvas.width = 0; src.canvas.height = 0;
  return { canvas, ax: ox, ay: oy, S: Sd };
}
