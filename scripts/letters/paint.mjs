/* LETR: paints one picture of a plan with Canvas 2D: shadow, 3D extrusion, outlines, fill, texture, shine, effects, dissolve.
   Works on any 2D context (HTMLCanvas, OffscreenCanvas). Everything is drawn from outlines at the final pixel size. */
import { bbox } from "./geom.mjs";
import { rng } from "./rng.mjs";
import { pictureGeometry, settleCenter } from "./shape.mjs";

export const MAX_SIDE = 2048;

function path(ctx, cs, S, ox, oy) {
  for ( const c of cs ) {
    ctx.moveTo(ox + c[0] * S, oy + c[1] * S);
    for ( let i = 2; i < c.length; i += 2 ) ctx.lineTo(ox + c[i] * S, oy + c[i + 1] * S);
    ctx.closePath();
  }
}

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
function extents(plan, geo, p) {
  const H = plan.hand, b = bbox(geo.flatMap((l) => l.cs));
  const outer = H.inflate + H.inkW + H.out2W + 0.05;
  const dx = Math.cos(H.depthAng) * H.depth, dy = Math.sin(H.depthAng) * H.depth;
  const sx = H.shadow ? Math.cos(H.shadow.ang) * H.shadow.d : 0, sy = H.shadow ? Math.sin(H.shadow.ang) * H.shadow.d : 0;
  let x0 = b.x0 - outer + Math.min(0, dx, dx + sx), x1 = b.x1 + outer + Math.max(0, dx, dx + sx);
  let y0 = b.y0 - outer + Math.min(0, dy, dy + sy), y1 = b.y1 + outer + Math.max(0, dy, dy + sy);
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  for ( const f of p.fx ) {
    const m = { krackle: 0.55, burst: 0.42, puff: 0.5, debris: 0.9, sparks: 0.45, embers: 0.6, rays: 0.5, droplets: 0.5, dust: 0.45 }[f.k];
    if ( m ) { x0 = Math.min(x0, b.x0 - m * Math.max(1, h)); x1 = Math.max(x1, b.x1 + m * Math.max(1, h)); y0 = Math.min(y0, b.y0 - m * Math.max(1, h) * (f.k === "embers" ? 1.6 : 1)); y1 = Math.max(y1, b.y1 + m * Math.max(1, h) * (f.k === "embers" ? 0.3 : 1)); }
    if ( f.k === "speed" ) { const L = Math.min(2.4, 0.6 + w * 0.5); if ( (f.dir ?? 1) > 0 ) x0 = Math.min(x0, b.x0 - L); else x1 = Math.max(x1, b.x1 + L); }
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
    default: g = ctx.createLinearGradient(0, Y0, 0, Y1); g.addColorStop(0, F[0]); g.addColorStop(0.55, F[1]); g.addColorStop(1, F[2]); return g;
  }
}

function texture(ctx, plan, kind, box, S, ox, oy, seed) {
  const H = plan.hand, R = rng(seed >>> 0);
  const X0 = ox + box.x0 * S, X1 = ox + box.x1 * S, Y0 = oy + box.y0 * S, Y1 = oy + box.y1 * S;
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
      const n = Math.min(500, Math.round((X1 - X0) * (Y1 - Y0) / Math.max(30, S * S * 0.012)));
      for ( let k = 0; k < n; k++ ) {
        ctx.fillStyle = R.chance(0.6) ? H.pal.fill[2] : H.pal.fill[0]; ctx.globalAlpha = R.f(0.35, 0.8);
        const r = R.f(0.008, 0.022) * S; ctx.beginPath(); ctx.arc(R.f(X0, X1), R.f(Y0, Y1), Math.max(0.6, r), 0, 6.2832); ctx.fill();
      }
      break;
    }
    case "cracks": {
      ctx.strokeStyle = H.ink; ctx.lineJoin = "miter"; ctx.lineCap = "round";
      const n = 2 + Math.round((X1 - X0) / S * 1.3);
      for ( let k = 0; k < n; k++ ) {
        let x = R.f(X0, X1), y = R.f(Y0, Y0 + (Y1 - Y0) * 0.4), a = R.f(0.9, 2.2), w = Math.max(1.2, S * 0.03);
        const walk = (x, y, a, w, len, depth) => {
          ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x, y);
          for ( let s = 0; s < len; s++ ) { a += R.f(-0.7, 0.7); x += Math.cos(a) * S * 0.09; y += Math.sin(a) * S * 0.09; ctx.lineTo(x, y); if ( depth < 2 && R.chance(0.25) ) { ctx.stroke(); walk(x, y, a + R.sign() * R.f(0.6, 1.2), w * 0.6, Math.round(len * 0.5), depth + 1); ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x, y); } }
          ctx.stroke();
        };
        walk(x, y, a, w, R.i(4, 9), 0);
      }
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
  /* small words: outlines in cap units would close the counters (a P turns into a blob below ~40 px), so they thin out with size,
     keeping at least about 1.5 px of ink. Hand-letterers do the same: small lettering gets a lighter line. */
  if ( S < 80 ) {
    const H0 = plan.hand, k = Math.max(0.38, S / 80), ink = Math.max(H0.inkW * k, Math.min(H0.inkW, 1.6 / Math.max(1, S)));
    plan = Object.create(plan, { hand: { value: { ...H0, inkW: ink, out2W: H0.out2W * k, inflate: H0.inflate * Math.max(0.6, k) } } });
  }
  const geo = pictureGeometry(plan, bank, p);
  const ext = extents(plan, geo, p);
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
    one(sx, sy); if ( H.depth ) one(ddx + sx, ddy + sy);
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
      ctx.fillStyle = k % 2 ? H.pal.fill[0] : H.pal.fill[1]; ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = outerW * 2 * S;
      ctx.fill(); ctx.stroke();
      if ( k === sm.n ) { ctx.strokeStyle = H.ink; ctx.lineWidth = Math.max(1, S * 0.02); ctx.stroke(); }
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
  const groups = H.stack === "merge" ? [{ i: -1, cs: all }] : geo;
  const n = plan.chars.length;
  const fullBox = { x0: wb.x0, y0: wb.y0, x1: wb.x1, y1: wb.y1 };
  const passes = (grp) => {
    const box = grp.i < 0 ? fullBox : bbox(grp.cs);
    const pathG = () => { ctx.beginPath(); path(ctx, grp.cs, S, ox, oy); };
    if ( H.out2W > 0 ) {
      pathG(); ctx.strokeStyle = H.outline === "sticker" ? (H.pal.out2 === "#1b1020" ? "#ffffff" : H.pal.out2) : H.pal.out2;
      ctx.lineWidth = outerW * 2 * S; ctx.stroke();
      if ( H.outline === "sticker" ) { ctx.strokeStyle = H.ink; ctx.lineWidth = Math.max(1, S * 0.018); ctx.save(); ctx.lineWidth = (outerW * 2 + 0.03) * S; ctx.globalCompositeOperation = "destination-over"; ctx.stroke(); ctx.restore(); }
    }
    pathG(); ctx.strokeStyle = H.ink; ctx.lineWidth = (H.inflate + H.inkW) * 2 * S; ctx.stroke();
    const fp = H.fill === "letters" && grp.i < 0 ? null : fillPaint(ctx, H, H.fill, H.fill === "letters" ? box : fullBox, S, ox, oy, grp.i, n);
    if ( fp ) {
      pathG(); ctx.fillStyle = fp; ctx.fill();
      if ( H.inflate > 0 ) { ctx.strokeStyle = fp; ctx.lineWidth = H.inflate * 2 * S; ctx.lineJoin = "round"; ctx.stroke(); }
    } else for ( const l of geo ) {
      const b = bbox(l.cs); ctx.beginPath(); path(ctx, l.cs, S, ox, oy);
      const f2 = fillPaint(ctx, H, "letters", b, S, ox, oy, l.i, n); ctx.fillStyle = f2; ctx.fill();
      if ( H.inflate > 0 ) { ctx.strokeStyle = f2; ctx.lineWidth = H.inflate * 2 * S; ctx.lineJoin = "round"; ctx.stroke(); }
    }
    /* inside the letter: texture, shine, inner line */
    ctx.save(); pathG();
    if ( H.inflate > 0 ) { /* clip includes the inflated rim: approximate by stroking into a mask is costly; clip to the core outline */ }
    ctx.clip();
    if ( H.tex !== "none" ) texture(ctx, plan, H.tex, box, S, ox, oy, (plan.seed ^ (grp.i + 7) * 40503) >>> 0);
    if ( H.gloss ) {
      const Y0 = oy + box.y0 * S, Y1 = oy + box.y1 * S, g = ctx.createLinearGradient(0, Y0, 0, Y0 + (Y1 - Y0) * 0.5);
      g.addColorStop(0, "rgba(255,255,255,0.55)"); g.addColorStop(1, "rgba(255,255,255,0)"); ctx.fillStyle = g; ctx.fillRect(ox + box.x0 * S - 4, Y0 - 4, (box.x1 - box.x0) * S + 8, (Y1 - Y0) * 0.5 + 4);
    }
    if ( H.bevel ) { ctx.save(); ctx.translate(S * 0.035, S * 0.035); pathG(); ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = S * 0.05; ctx.stroke(); ctx.restore(); ctx.save(); ctx.translate(-S * 0.03, -S * 0.03); pathG(); ctx.strokeStyle = "rgba(10,0,20,0.28)"; ctx.lineWidth = S * 0.05; ctx.stroke(); ctx.restore(); }
    if ( H.outline === "inner" ) { pathG(); ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = Math.max(1.2, S * 0.05); ctx.stroke(); pathG(); ctx.strokeStyle = fp ?? H.pal.fill[1]; ctx.lineWidth = Math.max(0.6, S * 0.022); ctx.stroke(); }
    ctx.restore();
  };
  for ( const grp of groups ) passes(grp);

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
