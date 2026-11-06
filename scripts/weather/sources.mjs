import { mapPixels } from "../destruction/source.mjs";

/**
 * The two shared textures of the weather passes, built on the CPU ONCE (never per frame):
 *
 *  GROUND INFO: the scene's map at art resolution (rgb) and its local contrast (a = 3x3-smoothed gradient magnitude x 4), so the
 *    ground pass can darken the map's own colours, find flat bright surfaces (roads, flagstones: sheen, puddles) and guess painted
 *    water. Built per (scene, background, art grid); ~10-60 ms once, at idle. Huge scenes use a coarser texel (cap 2048 per side).
 *    Also the map's average colour (the weather palette is derived from it).
 *
 *  SHELTER: where the sky is open, per texel: r = not under a roof (tiles with "restricts weather"), g = not in a Suppress Weather
 *    region, each a chamfer distance ramp over FADE art px (the shader dithers the ramp: a pixel-art fade, never soft alpha), b unused.
 *    Rebuilt only when tiles or regions change (debounced hooks in weather.mjs).
 */
export const FADE = 4;            // art px of the dithered fade at a roof eave or a region edge
const CAP = 2048;

/** The texel layout for an art grid: { w, h, scale } (scale = art cells per texel). */
export function layoutOf(aw, ah) {
  const scale = Math.max(1, Math.ceil(Math.max(aw, ah) / CAP));
  return { w: Math.ceil(aw / scale), h: Math.ceil(ah / scale), scale };
}

const tex = (data, w, h) => PIXI.Texture.fromBuffer(data, w, h, { scaleMode: PIXI.SCALE_MODES.NEAREST, mipmap: PIXI.MIPMAP_MODES.OFF, alphaMode: PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA });

/** Contrast from rgba pixels: |grad lum| smoothed 3x3, into the alpha channel (x 4, 0..255). Returns the average colour [r, g, b] 0..1. */
export function withContrast(px, w, h) {
  const n = w * h, L = new Float32Array(n);
  let r = 0, g = 0, b = 0;
  for ( let i = 0; i < n; i++ ) {
    const o = i * 4; L[i] = (0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2]) / 255;
    r += px[o]; g += px[o + 1]; b += px[o + 2];
  }
  const C = new Float32Array(n), T = new Float32Array(n);
  for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) {
    const i = y * w + x;
    const gx = x > 0 && x < w - 1 ? L[i + 1] - L[i - 1] : 0, gy = y > 0 && y < h - 1 ? L[i + w] - L[i - w] : 0;
    C[i] = Math.sqrt(gx * gx + gy * gy);
  }
  for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) {
    let s = 0, c = 0; for ( let d = -1; d <= 1; d++ ) { const xx = x + d; if ( xx >= 0 && xx < w ) { s += C[y * w + xx]; c++; } } T[y * w + x] = s / c;
  }
  for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) {
    let s = 0, c = 0; for ( let d = -1; d <= 1; d++ ) { const yy = y + d; if ( yy >= 0 && yy < h ) { s += T[yy * w + x]; c++; } }
    px[(y * w + x) * 4 + 3] = Math.min(255, Math.round(s / c * 4 * 255));
  }
  return n ? [r / n / 255, g / n / 255, b / n / 255] : [0.5, 0.5, 0.5];
}

/** Build the ground info of the open scene for art grid { ap, aw, ah }: { texture, w, h, scale, avg, key }. */
export function buildInfo(geo) {
  const L = layoutOf(geo.aw, geo.ah);
  const px = mapPixels(geo.ap * L.scale, { x0: 0, y0: 0, w: L.w, h: L.h });
  const data = new Uint8Array(px.buffer, px.byteOffset, px.byteLength);
  const avg = withContrast(data, L.w, L.h);
  return { texture: tex(data, L.w, L.h), ...L, avg };
}

/**
 * Chamfer distance (3-4) to the nearest blocked texel, as a ramp 0 (blocked) .. 255 (FADE art px away or more), in place on `ch`
 * (one channel of rgba bytes: 0 = blocked, 255 = open on input).
 */
export function fadeRamp(px, w, h, ch, fadeTexels) {
  const n = w * h, INF = 1e9, D = new Float32Array(n);
  for ( let i = 0; i < n; i++ ) D[i] = px[i * 4 + ch] ? INF : 0;
  const at = (x, y) => D[y * w + x];
  for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) {
    let d = at(x, y); if ( d === 0 ) continue;
    if ( x > 0 ) d = Math.min(d, at(x - 1, y) + 3);
    if ( y > 0 ) { d = Math.min(d, at(x, y - 1) + 3); if ( x > 0 ) d = Math.min(d, at(x - 1, y - 1) + 4); if ( x < w - 1 ) d = Math.min(d, at(x + 1, y - 1) + 4); }
    D[y * w + x] = d;
  }
  for ( let y = h - 1; y >= 0; y-- ) for ( let x = w - 1; x >= 0; x-- ) {
    let d = at(x, y); if ( d === 0 ) continue;
    if ( x < w - 1 ) d = Math.min(d, at(x + 1, y) + 3);
    if ( y < h - 1 ) { d = Math.min(d, at(x, y + 1) + 3); if ( x < w - 1 ) d = Math.min(d, at(x + 1, y + 1) + 4); if ( x > 0 ) d = Math.min(d, at(x - 1, y + 1) + 4); }
    D[y * w + x] = d;
  }
  const full = Math.max(1, fadeTexels) * 3;
  for ( let i = 0; i < n; i++ ) px[i * 4 + ch] = Math.round(Math.min(1, D[i] / full) * 255);
}

/** The shapes that keep the weather off: { roofs: [polygon points], regions: [polygon points] } in scene px. */
export function shelterShapes(scene = canvas.scene) {
  const roofs = [], regions = [];
  for ( const t of scene?.tiles ?? [] ) {
    if ( !t.restrictions?.weather || t.hidden && !game.user.isGM ) continue;
    // (v12+: the document's x, y is the tile's centre; the drawn tile's bounds say where it is, rotated or not)
    const { width: w, height: h } = t, a = (t.rotation || 0) * Math.PI / 180, b = t.object?.bounds;
    const cx = b ? b.x + b.width / 2 : t.x, cy = b ? b.y + b.height / 2 : t.y;
    const c = Math.cos(a), s = Math.sin(a);
    roofs.push([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].flatMap(([u, v]) => [cx + u * c - v * s, cy + u * s + v * c]));
  }
  for ( const r of scene?.regions ?? [] ) {
    if ( !r.behaviors?.some((b) => b.type === "suppressWeather" && !b.disabled) ) continue;
    for ( const p of r.polygons ?? [] ) regions.push({ points: Array.from(p.points), hole: p.isPositive === false });
  }
  return { roofs, regions };
}

/** Build the shelter texture for art grid geo (+ its layout): { texture, any } (null when nothing shelters). */
export function buildShelter(geo, L, shapes) {
  if ( !shapes.roofs.length && !shapes.regions.length ) return null;
  const c = new OffscreenCanvas(L.w, L.h), ctx = c.getContext("2d", { willReadFrequently: true });
  const k = 1 / (geo.ap * L.scale);
  const fill = (list, color) => {
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, L.w, L.h);
    ctx.fillStyle = color;
    for ( const it of list ) {
      const pts = Array.isArray(it) ? it : it.points;
      ctx.globalCompositeOperation = it.hole ? "destination-out" : "source-over";
      ctx.beginPath();
      for ( let i = 0; i < pts.length; i += 2 ) { const x = (pts[i] - geo.ox) * k, y = (pts[i + 1] - geo.oy) * k; if ( i ) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.closePath(); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    return ctx.getImageData(0, 0, L.w, L.h).data;
  };
  const out = new Uint8Array(L.w * L.h * 4);
  const roofs = fill(shapes.roofs, "#fff"), n = L.w * L.h;
  for ( let i = 0; i < n; i++ ) out[i * 4] = roofs[i * 4] > 127 ? 0 : 255;
  const regs = fill(shapes.regions, "#fff");
  for ( let i = 0; i < n; i++ ) { out[i * 4 + 1] = regs[i * 4] > 127 ? 0 : 255; out[i * 4 + 3] = 255; }
  const ft = FADE / L.scale;
  fadeRamp(out, L.w, L.h, 0, ft); fadeRamp(out, L.w, L.h, 1, ft);
  return { texture: tex(out, L.w, L.h) };
}
