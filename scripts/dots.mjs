/**
 * Halftone ("Ben-Day") dot fill for districts. Painted once per bake into the district's texture on a 2D canvas, clipped to the
 * smooth outline (holes included). Dots are laid out in world units (fractions of the grid size), so they keep one map size at any
 * zoom; the texture resolution follows the zoom instead (see dotRes in districts.mjs).
 */
import { sceneConfig, DOT_DEFAULTS } from "./config.mjs";
import { fg } from "./labels.mjs";

const T = (k) => game.i18n.localize(`MOINENMAPS.${k}`);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));


/** Effective dot settings: per-district > scene default > built-in. */
export function dotsCfg(d, scene = canvas.scene) {
  const c = { ...DOT_DEFAULTS, ...(sceneConfig(scene).dots ?? {}), ...(d?.dots ?? {}) };
  return { ...c, size: clamp(Number(c.size) || DOT_DEFAULTS.size, 0.1, 1.2), spacing: clamp(Number(c.spacing) || DOT_DEFAULTS.spacing, 0.05, 0.8), angle: Number(c.angle) || 0,
    tint: clamp(Number(c.tint) || 0, 0, 1), useFill: !!c.useFill, overprint: !!c.overprint };
}

/* ------------------------------------------------------------------ painting */

/** Distance (0..1, 1 = deepest point) from the nearest edge, on a coarse grid: a two-pass chamfer transform of the district mask. */
function distanceField(pathOn, bb, S) {
  const w = bb.x1 - bb.x0, h = bb.y1 - bb.y0, cell = Math.max(S / 10, Math.max(w, h) / 256);
  const gw = Math.ceil(w / cell) + 3, gh = Math.ceil(h / cell) + 3;
  const cv = document.createElement("canvas"); cv.width = gw; cv.height = gh;
  const x = cv.getContext("2d", { willReadFrequently: true });
  x.scale(1 / cell, 1 / cell); x.translate(-bb.x0 + cell, -bb.y0 + cell);
  pathOn(x); x.fillStyle = "#fff"; x.fill("evenodd");
  const px = x.getImageData(0, 0, gw, gh).data, D = new Float32Array(gw * gh), BIG = 1e6, R2 = Math.SQRT2;
  for ( let i = 0; i < D.length; i++ ) D[i] = px[i * 4 + 3] > 127 ? BIG : 0;
  for ( let j = 1; j < gh - 1; j++ ) for ( let i = 1; i < gw - 1; i++ ) {
    const k = j * gw + i; if ( !D[k] ) continue;
    D[k] = Math.min(D[k], D[k - 1] + 1, D[k - gw] + 1, D[k - gw - 1] + R2, D[k - gw + 1] + R2);
  }
  let max = 0;
  for ( let j = gh - 2; j > 0; j-- ) for ( let i = gw - 2; i > 0; i-- ) {
    const k = j * gw + i; if ( !D[k] ) continue;
    D[k] = Math.min(D[k], D[k + 1] + 1, D[k + gw] + 1, D[k + gw + 1] + R2, D[k + gw - 1] + R2);
    if ( D[k] < BIG && D[k] > max ) max = D[k];
  }
  const ref = Math.max(max, (S * 0.25) / cell);
  return { at: (wx, wy) => {
    const i = Math.floor((wx - bb.x0) / cell) + 1, j = Math.floor((wy - bb.y0) / cell) + 1;
    if ( i < 0 || j < 0 || i >= gw || j >= gh ) return 0;
    return Math.min(1, D[j * gw + i] / ref);
  } };
}

function layer(ctx, o) {
  const { bb, sp, rmax, angle, shape, fill, alpha, offx = 0, offy = 0, df, grad } = o;
  const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2, R = Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0) / 2 + sp * 2, N = Math.ceil(R / sp);
  const a = angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const rot = shape === "diamond" ? a : a + Math.PI / 4;   // square: edges follow the lattice, diamond: corners do
  ctx.beginPath();
  for ( let i = -N; i <= N; i++ ) for ( let j = -N; j <= N; j++ ) {
    const px = i * sp, py = j * sp, x = cx + px * ca - py * sa + offx, y = cy + px * sa + py * ca + offy;
    if ( x < bb.x0 - sp || x > bb.x1 + sp || y < bb.y0 - sp || y > bb.y1 + sp ) continue;
    let r = rmax;
    if ( df ) { const t = df.at(x, y); r = rmax * (grad === "in" ? 0.12 + 0.88 * t : 1 - 0.88 * t); }
    if ( r < 0.3 ) continue;
    if ( shape === "round" ) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
    else {
      const rr = r * 1.15;
      for ( let k = 0; k < 4; k++ ) { const an = rot + k * Math.PI / 2, qx = x + Math.cos(an) * rr, qy = y + Math.sin(an) * rr; k ? ctx.lineTo(qx, qy) : ctx.moveTo(qx, qy); }
      ctx.closePath();
    }
  }
  ctx.fillStyle = fill; ctx.globalAlpha = alpha; ctx.fill();
  ctx.globalAlpha = 1;
}

/**
 * Paint the dots into `ctx` (already scaled to world units). `pathOn(c)` adds the district outline to any 2D context in world coordinates.
 * `color` is the district colour (or the ink for a colourless district); `dark` mixes a colour toward the ink for the overprint layer.
 */
export function paintDots(ctx, { pathOn, bb, S, color, none, cfg, dark }) {
  let sp = cfg.spacing * S;
  const area = (bb.x1 - bb.x0) * (bb.y1 - bb.y0);
  if ( area / (sp * sp) > 70000 ) sp = Math.sqrt(area / 70000);   // keeps a huge district from baking an absurd number of dots
  const rmax = Math.max(0.6, cfg.size * sp / 2);
  const df = cfg.gradient !== "none" ? distanceField(pathOn, bb, S) : null;
  const fill = cfg.useFill ? color : cfg.color;
  ctx.save();
  pathOn(ctx); ctx.clip("evenodd");
  if ( cfg.overprint ) {
    // a second, slightly smaller, darker screen at another angle and offset by a hair: reads as a misregistered print
    layer(ctx, { bb, sp, rmax: rmax * 0.72, angle: cfg.angle + 30, shape: cfg.shape, fill: dark, alpha: none ? 0.35 : 0.5, offx: sp * 0.3, offy: sp * 0.22, df, grad: cfg.gradient });
  }
  layer(ctx, { bb, sp, rmax, angle: cfg.angle, shape: cfg.shape, fill, alpha: none ? 0.6 : 0.88, df, grad: cfg.gradient });
  ctx.restore();
}

/* ------------------------------------------------------------------ UI */

/** The dot controls. `p` is the field-name prefix, `v` the effective values. */
export function dotsFieldsHtml(p, v) {
  const rng = (n, val, min, max, step) => `<range-picker name="${p}${n}" value="${val}" min="${min}" max="${max}" step="${step}"></range-picker>`;
  const sel = (n, val, opts) => `<select name="${p}${n}">${opts.map(([a, b]) => `<option value="${a}"${a === val ? " selected" : ""}>${esc(b)}</option>`).join("")}</select>`;
  return `${fg(T("Dots.size"), rng("size", v.size, 0.1, 1.2, 0.05), T("Dots.sizeHint"))}
    ${fg(T("Dots.spacing"), rng("spacing", v.spacing, 0.05, 0.8, 0.01), T("Dots.spacingHint"))}
    ${fg(T("Dots.angle"), rng("angle", v.angle, 0, 90, 1))}
    ${fg(T("Dots.shape"), sel("shape", v.shape, [["round", T("Dots.round")], ["square", T("Dots.square")], ["diamond", T("Dots.diamond")]]))}
    ${fg(T("Dots.gradient"), sel("gradient", v.gradient, [["none", T("Dots.gradNone")], ["in", T("Dots.gradIn")], ["out", T("Dots.gradOut")]]))}
    ${fg(T("Dots.color"), `<label class="mm-inline"><input type="checkbox" name="${p}useFill"${v.useFill ? " checked" : ""}> ${esc(T("Dots.useFill"))}</label><color-picker name="${p}color" value="${esc(v.color)}"></color-picker>`)}
    ${fg(T("Dots.tint"), rng("tint", v.tint, 0, 1, 0.05), T("Dots.tintHint"))}
    ${fg(T("Dots.overprint"), `<input type="checkbox" name="${p}overprint"${v.overprint ? " checked" : ""}>`, T("Dots.overprintHint"))}`;
}

export function readDotsValues(vals, p) {
  return { size: Number(vals[p + "size"]), spacing: Number(vals[p + "spacing"]), angle: Number(vals[p + "angle"]), shape: vals[p + "shape"], gradient: vals[p + "gradient"],
    useFill: !!vals[p + "useFill"], color: vals[p + "color"], tint: Number(vals[p + "tint"]), overprint: !!vals[p + "overprint"] };
}

/** Grey out the colour picker while "use the district colour" is on. */
export function wireDotsFields(root, p) {
  const upd = () => { const cp = root.querySelector(`[name="${p}color"]`), uf = root.querySelector(`[name="${p}useFill"]`); if ( cp && uf ) { cp.inert = uf.checked; cp.classList.toggle("is-off", uf.checked); } };
  root.addEventListener("change", upd); upd();
}
