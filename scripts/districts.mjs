/**
 * Districts: a decorative, hand-inked overlay for marking neighbourhoods and territories.
 *
 * Storage: one scene flag, `flags.moinen-maps.districts = [{id, name, color, border, fill, opacity, hover, revealed, rings}]`.
 * Chosen over Drawing documents because a flag syncs atomically with the scene, keeps the whole set in one update, and lets
 * us render the ink/hatch/glow look ourselves (a Drawing can only draw a flat polygon). Rings are small flat integer arrays
 * (a brush stroke is unioned with Clipper, cleaned and Douglas-Peucker simplified); smoothing happens when baking.
 * Rendering: every district is baked once per change into two textures (look + silhouette) on a canvas 2D context, shown as
 * sprites in one container; hover and appear animations only tween sprite alpha/scale/filter on a shared ticker.
 */
import { MODULE_ID, sceneConfig, reducedMotion } from "./config.mjs";
import { swatchesHtml, wireSwatches, activeToolName } from "./tools.mjs";
import { PIN_COLORS } from "./config.mjs";
import { attrsOf, attrEditorHtml, wireAttrEditor, collectAttrs, cleanAttrs, writeAttrs, showCard, moveCard, hideCard, destroyCard, inkFor, fmt, pruneStore } from "./attrs.mjs";
import { dotsCfg, paintDots, dotsFieldsHtml, readDotsValues, wireDotsFields } from "./dots.mjs";
import { labelCfg, ensureFont, buildLabel, labelFieldsHtml, readLabelValues, wireFontPreview, fg, fgGroup, fitDialog, liveBarHtml, wireLiveBar, frameThrottle } from "./labels.mjs";

const T = (k) => game.i18n.localize(`MOINENMAPS.${k}`);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const SC = 10;                 // Clipper works on integers: world px * SC
const FLAG = "districts";
const PAINT = "mm-district", ERASE = "mm-district-erase";
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const CL = () => globalThis.ClipperLib;
const INK = "#15110f";

/* ------------------------------------------------------------------ geometry */

const toPath = (flat) => { const p = []; for ( let i = 0; i < flat.length; i += 2 ) p.push({ X: Math.round(flat[i] * SC), Y: Math.round(flat[i + 1] * SC) }); return p; };
const fromPath = (p) => { const f = []; for ( const q of p ) f.push(Math.round(q.X / SC), Math.round(q.Y / SC)); return f; };

function dp(pts, tol) {
  if ( pts.length < 3 ) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while ( stack.length ) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    for ( let i = a + 1; i < b; i++ ) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if ( d > max ) { max = d; idx = i; }
    }
    if ( max > tol && idx > 0 ) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function simplifyRing(flat, tol) {
  const pts = []; for ( let i = 0; i < flat.length; i += 2 ) pts.push([flat[i], flat[i + 1]]);
  if ( pts.length < 3 ) return null;
  // a closed ring has identical ends, which breaks Douglas-Peucker: split at the point farthest from the start
  let k = 1, far = -1;
  pts.forEach((p, i) => { const d = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]); if ( d > far ) { far = d; k = i; } });
  const a = dp(pts.slice(0, k + 1), tol), b = dp(pts.slice(k).concat([pts[0]]), tol);
  const out = a.concat(b.slice(1, -1));
  return out.length >= 3 ? out.flat() : null;
}

/** A brush stroke (polyline of world points) to polygon paths. */
function strokePaths(pts, r) {
  const C = CL(), co = new C.ClipperOffset(2, 0.6 * SC);
  let path = pts.map(([x, y]) => ({ X: Math.round(x * SC), Y: Math.round(y * SC) }));
  if ( path.length === 1 ) path = [path[0], { X: path[0].X + SC, Y: path[0].Y }];
  co.AddPath(path, C.JoinType.jtRound, C.EndType.etOpenRound);
  const sol = new C.Paths();
  co.Execute(sol, r * SC);
  return sol;
}

function boolean(type, subj, clip) {
  const C = CL(), c = new C.Clipper(), sol = new C.Paths();
  c.AddPaths(subj, C.PolyType.ptSubject, true); c.AddPaths(clip, C.PolyType.ptClip, true);
  c.Execute(type, sol, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return sol;
}

/** Clean, simplify and convert Clipper paths to small flat rings. */
function finish(paths) {
  const C = CL(), S = canvas.grid.size;
  let cleaned = C.Clipper.SimplifyPolygons(paths, C.PolyFillType.pftNonZero);
  cleaned = C.Clipper.CleanPolygons(cleaned, SC * 0.8);
  let tol = S * 0.035, rings;
  for ( let tries = 0; tries < 4; tries++, tol *= 1.6 ) {
    rings = cleaned.filter((p) => Math.abs(C.Clipper.Area(p)) / (SC * SC) > (S * 0.25) ** 2)
      .map((p) => simplifyRing(fromPath(p), tol)).filter(Boolean);
    if ( rings.reduce((n, r) => n + r.length / 2, 0) <= 220 ) break;
  }
  return rings;
}

function pointInRings(x, y, rings) {
  let inside = false;
  for ( const r of rings ) {
    for ( let i = 0, j = r.length - 2; i < r.length; j = i, i += 2 ) {
      const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if ( (yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi ) inside = !inside;
    }
  }
  return inside;
}
const bboxOf = (rings) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for ( const r of rings ) for ( let i = 0; i < r.length; i += 2 ) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); }
  return { x0, y0, x1, y1 };
};

/** Approximate pole of inaccessibility (the label spot): coarse grid, pick the inside point farthest from every edge. */
function labelSpot(rings, bb) {
  const N = 26, w = bb.x1 - bb.x0, h = bb.y1 - bb.y0;
  let best = { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2, d: -1 };
  for ( let i = 0; i <= N; i++ ) for ( let j = 0; j <= N; j++ ) {
    const x = bb.x0 + (w * i) / N, y = bb.y0 + (h * j) / N;
    if ( !pointInRings(x, y, rings) ) continue;
    let d = Infinity;
    for ( const r of rings ) for ( let k = 0, m = r.length - 2; k < r.length; m = k, k += 2 ) {
      const ax = r[m], ay = r[m + 1], bx = r[k], by = r[k + 1], dx = bx - ax, dy = by - ay;
      const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
      d = Math.min(d, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
    if ( d > best.d ) best = { x, y, d };
  }
  return best;
}

/* ------------------------------------------------------------------ baking */

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hashStr = (s) => { let h = 7; for ( const c of s ) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };

function chaikin(pts, n) {
  for ( let k = 0; k < n; k++ ) {
    const out = [];
    for ( let i = 0; i < pts.length; i++ ) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    pts = out;
  }
  return pts;
}

let noisePattern;
function noiseCanvas() {
  if ( noisePattern ) return noisePattern;
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const ctx = c.getContext("2d"), img = ctx.createImageData(128, 128), r = rng(5);
  for ( let i = 0; i < img.data.length; i += 4 ) {
    const v = r() < 0.5 ? 255 : 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = (r() ** 2) * 60;
  }
  ctx.putImageData(img, 0, 0);
  return (noisePattern = c);
}

/** Per-district value, else the scene default, else the built-in default (0 and "" are real values, never "missing"). */
const pick = (v, fallback) => (v === undefined || v === null || (typeof v === "number" && Number.isNaN(v))) ? fallback : v;
const DKEYS = { opacity: "districtOpacity", ink: "districtInk", inkOpacity: "districtInkOpacity", inkWidth: "districtInkWidth", inkColor: "districtInkColor" };
function look(d) {
  const sc = sceneConfig(canvas.scene);
  return {
    opacity: clamp(Number(pick(d.opacity, sc.districtOpacity)), 0, 1),
    ink: pick(d.ink, sc.districtInk),                       // "ink" | "match" | "custom"
    inkColor: pick(d.inkColor, sc.districtInkColor),
    inkOpacity: clamp(Number(pick(d.inkOpacity, sc.districtInkOpacity)), 0, 1),
    inkWidth: clamp(Number(pick(d.inkWidth, sc.districtInkWidth)), 0.2, 4)
  };
}
/** Read a dialog form including custom elements (range-picker, color-picker), which FormData silently omits. */
function readForm(form) {
  const out = {};
  for ( const el of form.querySelectorAll("[name]") ) {
    if ( el.type === "checkbox" ) out[el.name] = el.checked;
    else if ( el.type === "radio" ) { if ( el.checked ) out[el.name] = el.value; }
    else out[el.name] = el.value;
  }
  return out;
}
const isNone = (c) => !c || c === "none";
const mix = (hex, to, t) => {
  const a = Color.from(hex), b = Color.from(to);
  return `rgb(${[0, 1, 2].map((i) => Math.round(a.rgb[i] * 255 * (1 - t) + b.rgb[i] * 255 * t)).join(",")})`;
};

/** Texture resolution for a halftone district: follows the zoom (crisp dots when zoomed in), capped by texture size and memory. */
function dotRes(w, h) {
  const z = canvas.stage?.scale?.x ?? 1, dpr = window.devicePixelRatio || 1;
  const r = clamp(2 ** Math.ceil(Math.log2(Math.max(0.5, z * dpr))), 1, 4);
  return Math.max(0.25, Math.min(r, 4096 / Math.max(w, h), Math.sqrt(16e6 / (w * h))));
}

/** Bake a district into {look, silhouette} canvases. */
function bake(d) {
  const S = canvas.grid.size, rnd = rng(hashStr(d.id));
  const rings = d.rings.map((flat) => {
    let pts = []; for ( let i = 0; i < flat.length; i += 2 ) pts.push([flat[i], flat[i + 1]]);
    return chaikin(pts, 3);
  });
  const flatBB = bboxOf(rings.map((r) => r.flat()));
  const pad = S * 0.4, w = flatBB.x1 - flatBB.x0 + pad * 2, h = flatBB.y1 - flatBB.y0 + pad * 2;
  const res = d.fill === "dots" ? dotRes(w, h) : Math.min(2, 2048 / Math.max(w, h));
  const mk = () => { const c = document.createElement("canvas"); c.width = Math.ceil(w * res); c.height = Math.ceil(h * res); const x = c.getContext("2d"); x.scale(res, res); x.translate(-flatBB.x0 + pad, -flatBB.y0 + pad); x.lineCap = x.lineJoin = "round"; return x; };
  const path = (ctx, jitter = 0, seed = 0) => {
    ctx.beginPath();
    const r2 = rng(hashStr(d.id) + seed);
    for ( const ring of rings ) {
      const ph = [r2() * 6.28, r2() * 6.28];
      ring.forEach(([x, y], i) => {
        const j = jitter ? jitter * (Math.sin(i * 0.37 + ph[0]) * 0.7 + Math.sin(i * 0.91 + ph[1]) * 0.3) : 0;
        const nx = x + j, ny = y + j * 0.8;
        i ? ctx.lineTo(nx, ny) : ctx.moveTo(nx, ny);
      });
      ctx.closePath();
    }
  };
  const none = isNone(d.color), col = none ? INK : d.color, op = 1, L = look(d);
  const dotsFill = d.fill === "dots", DC = dotsFill ? dotsCfg(d) : null;

  // look
  const ctx = mk();
  if ( !none ) {   // a district without colour has no tint at all: only its ink, hatching and label
    path(ctx);
    ctx.globalAlpha = (dotsFill ? DC.tint : 0.5) * op; ctx.fillStyle = col; ctx.fill("evenodd"); ctx.globalAlpha = 1;
    // feathered inner glow
    ctx.save(); path(ctx); ctx.clip("evenodd");
    try { ctx.filter = `blur(${S * 0.12}px)`; } catch {}
    ctx.strokeStyle = col; ctx.globalAlpha = (dotsFill ? 0 : 0.85) * op; ctx.lineWidth = S * 0.34; path(ctx); ctx.stroke(); ctx.restore();
  }
  // fill treatment
  if ( d.fill === "hatch" ) {
    ctx.save(); path(ctx); ctx.clip("evenodd");
    ctx.strokeStyle = mix(col, INK, 0.45); ctx.globalAlpha = 0.34 * op; ctx.lineWidth = S * 0.022;
    const step = S * 0.15, W = flatBB.x1 - flatBB.x0 + pad * 2;
    for ( let o = -(h); o < W + h; o += step ) {
      ctx.beginPath(); ctx.moveTo(flatBB.x0 - pad + o + (rnd() - 0.5) * 2, flatBB.y0 - pad); ctx.lineTo(flatBB.x0 - pad + o - h + (rnd() - 0.5) * 2, flatBB.y1 + pad); ctx.stroke();
    }
    ctx.restore();
  } else if ( dotsFill ) {
    paintDots(ctx, { pathOn: (c) => path(c), bb: flatBB, S, color: col, none, cfg: DC, dark: mix(col, INK, 0.45) });
  } else if ( d.fill === "paper" ) {
    ctx.save(); path(ctx); ctx.clip("evenodd");
    ctx.globalAlpha = 0.55 * op; ctx.fillStyle = ctx.createPattern(noiseCanvas(), "repeat"); ctx.fillRect(flatBB.x0 - pad, flatBB.y0 - pad, w, h);
    ctx.restore();
  }
  // wobbly inked border: two jittered passes, slightly offset from the fill like the pin outline (skipped for "none")
  if ( d.border !== "none" ) {
    const ink = L.ink === "custom" ? (L.inkColor || INK) : L.ink === "match" ? (none ? INK : mix(col, INK, 0.55)) : INK;
    ctx.globalAlpha = 0.95 * L.inkOpacity; ctx.strokeStyle = ink;
    if ( d.border === "dashed" ) ctx.setLineDash([S * 0.2, S * 0.12]);
    ctx.lineWidth = S * 0.075 * L.inkWidth; path(ctx, S * 0.012, 1); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 0.55 * L.inkOpacity; ctx.lineWidth = S * 0.03 * L.inkWidth;
    if ( d.border === "dashed" ) ctx.setLineDash([S * 0.12, S * 0.2]);
    path(ctx, S * 0.02, 2); ctx.stroke();

  }

  // silhouette (for the highlight layer): soft white blob
  const sil = mk();
  try { sil.filter = `blur(${S * 0.05}px)`; } catch {}
  sil.fillStyle = "#fff"; path(sil); sil.fill("evenodd");
  return { look: ctx.canvas, sil: sil.canvas, x: flatBB.x0 - pad, y: flatBB.y0 - pad, res, w, h };
}

/* ------------------------------------------------------------------ views */

const VIEWS = new Map();
const LOCAL_HIDDEN = new Set();   // GM-only, this client only: hide a district on the canvas without touching the scene
const canShow = (d) => (d.revealed || game.user.isGM) && !LOCAL_HIDDEN.has(d.id);
let layer = null, cursor = null, live = null;
let ticking = false;

function sharedTick(frames) {
  const dt = Math.min(frames / 60, 0.05);
  let busy = false;
  for ( const v of VIEWS.values() ) if ( v.tick(dt) ) busy = true;
  if ( !busy ) { canvas.app.ticker.remove(sharedTick); ticking = false; }
}
const wake = () => { if ( !ticking && canvas.app?.ticker ) { canvas.app.ticker.add(sharedTick); ticking = true; } };

class DistrictView extends PIXI.Container {
  constructor(data, animate) {
    super();
    this.eventMode = "none";
    animate &&= !reducedMotion();
    this.hv = 0; this.target = 0; this.appear = animate ? 0 : 1;
    this.look = this.addChild(new PIXI.Sprite());
    this.hi = this.addChild(new PIXI.Sprite()); this.hi.alpha = 0;
    this.labelHost = this.addChild(new PIXI.Container()); this.labelHost.visible = false; this._lt = 0; this.labelW = 0; this.labelH = 0;
    this.attrHost = this.addChild(new PIXI.Container()); this.attrHost.visible = false; this.attrW = 0;
    this.filter = null; this.mapCont = null;
    this.set(data, animate);
    if ( animate ) wake();
  }

  set(data, animate) {
    this.data = data;
    this.sig = sig(data);
    this.dropMap();
    const b = bake(data);
    this.bakedRes = b.res; this.bakeDims = [b.w, b.h];
    for ( const [spr, cnv] of [[this.look, b.look], [this.hi, b.sil]] ) {
      spr.texture?.destroy(true);
      const tex = PIXI.Texture.from(cnv, { scaleMode: PIXI.SCALE_MODES.LINEAR });
      tex.baseTexture.mipmap = PIXI.MIPMAP_MODES.ON;
      spr.texture = tex; spr.position.set(b.x, b.y); spr.scale.set(1 / b.res);
    }
    this.bbox = bboxOf(data.rings); this.baseAlpha = game.user.isGM && !data.revealed ? 0.7 : 1;
    const spot = labelSpot(data.rings, this.bbox);
    this.spot = spot;
    this.refreshLabel();
    this.visible = canShow(data);
    this.asig = asig(data);
    this.origin = { x: spot.x, y: spot.y };
    if ( animate ) { this.appear = 0; wake(); }
    this.applyHover();
    this.applyZoom();
  }

  hoverCfg() {
    const sc = sceneConfig(canvas.scene), o = this.data.hover ?? {};
    let mode = o.mode && o.mode !== "inherit" ? o.mode : sc.hoverMode;
    if ( mode === "map" && !this.ensureMap() ) mode = "highlight";   // no usable background image: fall back
    return { mode, color: o.color || sc.hoverColor, strength: clamp(sc.hoverStrength, 0, 1) };
  }

  /** A halftone district re-bakes (debounced) when the zoom has moved far enough that its dots would blur or waste memory. */
  checkRes() {
    if ( this.data.fill !== "dots" || !this.bakeDims ) return;
    if ( dotRes(this.bakeDims[0], this.bakeDims[1]) === this.bakedRes ) { clearTimeout(this._rt); this._rt = 0; return; }
    if ( !this._rt ) this._rt = setTimeout(() => { this._rt = 0; if ( !this.destroyed ) this.set(this.data, false); }, 350);
  }

  destroy(opts) { clearTimeout(this._rt); super.destroy(opts); }

  dropMap() {
    if ( this.mapCont && !this.mapCont.destroyed ) { this.mapCont.mask = null; this.mapSprite?.texture?.destroy(false); this.mapCont.destroy({ children: true }); }
    this.mapCont = this.mapSprite = this.mapMask = this.mapFilter = null;
  }

  /** Lazily build the "saturate the map" layer: a crop of the scene background at exactly the district's footprint, masked by its cached shape. */
  ensureMap() {
    if ( this.mapCont ) return !this.mapCont.destroyed;
    const bg = canvas.primary?.background, tex = bg?.texture;
    if ( !tex?.valid || tex === PIXI.Texture.WHITE || !bg.visible || bg.rotation ) return false;
    const r = { x: this.hi.x, y: this.hi.y, w: this.hi.texture.width * this.hi.scale.x, h: this.hi.texture.height * this.hi.scale.y };
    const tw = tex.orig.width, th = tex.orig.height, sx = bg.scale.x || 1, sy = bg.scale.y || 1;
    // world -> background texture pixels (no rotation): local = (world - position) / scale + pivot, texture = local + anchor * size
    const toTexX = (wx) => (wx - bg.x) / sx + bg.pivot.x + bg.anchor.x * tw, toTexY = (wy) => (wy - bg.y) / sy + bg.pivot.y + bg.anchor.y * th;
    const tx = [toTexX(r.x), toTexX(r.x + r.w)], ty = [toTexY(r.y), toTexY(r.y + r.h)];
    const x0 = Math.max(0, Math.min(...tx)), y0 = Math.max(0, Math.min(...ty)), x1 = Math.min(tw, Math.max(...tx)), y1 = Math.min(th, Math.max(...ty));
    if ( x1 - x0 < 2 || y1 - y0 < 2 ) return false;
    const sub = new PIXI.Texture(tex.baseTexture, new PIXI.Rectangle(tex.frame.x + x0, tex.frame.y + y0, x1 - x0, y1 - y0));
    const spr = new PIXI.Sprite(sub);
    spr.position.set(bg.x + (x0 - bg.anchor.x * tw - bg.pivot.x) * sx, bg.y + (y0 - bg.anchor.y * th - bg.pivot.y) * sy);
    spr.scale.copyFrom(bg.scale);
    const mask = new PIXI.Sprite(this.hi.texture);
    mask.position.copyFrom(this.hi.position); mask.scale.copyFrom(this.hi.scale);
    const cont = new PIXI.Container(); cont.eventMode = "none"; cont.visible = false;
    cont.addChild(spr, mask); cont.mask = mask;
    this.mapFilter = new PIXI.ColorMatrixFilter(); spr.filters = [this.mapFilter];
    this.addChildAt(cont, this.getChildIndex(this.look)); // under the district look so the inked edge stays crisp on top
    Object.assign(this, { mapCont: cont, mapSprite: spr, mapMask: mask });
    return true;
  }

  setHover(on) { const t = on ? 1 : 0; if ( t !== this.target ) { this.target = t; wake(); } }

  /** (Re)build the label. Waits for the font so it is never baked with a fallback face; stale builds are dropped. */
  async refreshLabel() {
    const token = ++this._lt, data = this.data;
    if ( !data.name ) { this.labelHost.visible = false; this.labelH = 0; this.buildAttrs(); return; }
    const cfg = labelCfg(data);
    await ensureFont(cfg.family || CONFIG.defaultFontFamily, cfg.weight, cfg.italic);
    if ( token !== this._lt || this.destroyed ) return;
    for ( const c of this.labelHost.removeChildren() ) c.destroy({ children: true });
    const { node, width, height } = buildLabel(data.name, cfg, { d: this.spot.d, S: canvas.grid.size, tint: data.color });
    this.labelHost.addChild(node);
    this.labelHost.position.set(this.spot.x + cfg.offsetX * canvas.grid.size, this.spot.y + cfg.offsetY * canvas.grid.size);
    this.labelW = width; this.labelH = height; this.labelHost.visible = true;
    this.buildAttrs();
    this.applyZoom();
  }

  /** "Always" display: the attribute lines as one small inked text under the label, fitted to the district. Rebuilt only when attributes or settings change. */
  buildAttrs() {
    for ( const c of this.attrHost.removeChildren() ) c.destroy({ children: true });
    const data = this.data, attrs = sceneConfig(canvas.scene).attrDisplay === "always" ? attrsOf(data).filter((a) => a.name) : [];
    this.attrW = 0; this.attrHost.visible = false;
    if ( !attrs.length || this.destroyed ) return;
    const cfg = labelCfg(data), S = canvas.grid.size, { fill, stroke } = inkFor(data.color), BASE = 44;
    const text = new PIXI.Text(attrs.map((a) => `${a.name}: ${fmt(a.value)}`).join("\n"), new PIXI.TextStyle({
      fontFamily: `"${cfg.family || CONFIG.defaultFontFamily}", ${CONFIG.defaultFontFamily}, sans-serif`, fontWeight: "600", fontStyle: cfg.italic ? "italic" : "normal",
      fontSize: BASE, fill, stroke, strokeThickness: 7, lineJoin: "round", align: "center", lineHeight: BASE * 1.12
    }));
    text.anchor.set(0.5, 0); text.resolution = Math.max(2, window.devicePixelRatio || 1);
    const lineH = BASE * 1.12, s = Math.min(1, (S * 0.2) / lineH, (this.spot.d * 2.4) / Math.max(1, text.width));
    text.scale.set(s);
    const below = this.labelHost.visible ? this.labelH / 2 + S * 0.04 : -(lineH * s * attrs.length) / 2;
    this.attrHost.position.set(this.spot.x + cfg.offsetX * S, this.spot.y + cfg.offsetY * S + below);
    this.attrHost.addChild(text);
    this.attrW = text.width; this.attrHost.visible = true;
  }

  /** Zoom behaviour of the label: fade out when it would be tiny on screen. */
  applyZoom() {
    const z = canvas.stage.scale.x, px = this.labelW * z;
    this.labelHost.alpha = clamp((px - 36) / 40, 0, 1) * this.baseAlpha;
    this.attrHost.alpha = clamp((this.attrW * z - 28) / 28, 0, 1) * this.baseAlpha;
  }

  applyHover() {
    const { mode, color, strength } = this.hoverCfg(), h = this.hv;
    const op = look(this.data).opacity;
    const a = this.baseAlpha * this.appearEase() * op;
    this.look.alpha = a;
    if ( this.mapCont && !this.mapCont.destroyed ) {
      const on = mode === "map" && h > 0.001 && this.appear >= 1;
      this.mapCont.visible = on;
      if ( on ) {
        this.mapFilter.reset(); this.mapFilter.saturate(h * strength * 1.8, true); this.mapFilter.contrast(h * strength * 0.18, true);
        this.mapSprite.alpha = h;
      }
    }
    if ( mode === "saturate" && h > 0.001 ) {
      if ( !this.filter ) { this.filter = new PIXI.ColorMatrixFilter(); }
      this.filter.reset(); this.filter.saturate(h * strength * 1.6, true);
      this.look.filters = [this.filter]; this.look.alpha = Math.min(1, a * (1 + 0.45 * strength * h));
      this.hi.alpha = 0;
    } else {
      this.look.filters = null;
      if ( mode === "highlight" && h > 0.001 ) { this.hi.tint = Color.from(color); this.hi.alpha = h * strength * 0.65 * a; }
      else this.hi.alpha = 0;
    }
  }

  appearEase() { const t = this.appear; return t >= 1 ? 1 : clamp(t / 0.35, 0, 1); }

  tick(dt) {
    let busy = false;
    if ( this.appear < 1 ) {
      this.appear = Math.min(1, this.appear + dt / 0.75); busy = true;
      const k = this.appear, e = 1 + 2.4 * (k - 1) ** 3 + 1.4 * (k - 1) ** 2; // easeOutBack
      this.scaleAround(0.92 + 0.08 * e);
    }
    if ( this.hv !== this.target ) {
      this.hv += (this.target - this.hv) * Math.min(1, dt / 0.07);
      if ( Math.abs(this.hv - this.target) < 0.01 ) this.hv = this.target;
      busy = true;
    }
    if ( busy || this.hv ) this.applyHover();
    return busy;
  }
  scaleAround(s) {
    // scale the whole container about the label spot so the fill appears to bloom outwards
    this.scale.set(s); this.pivot.set(this.origin.x, this.origin.y); this.position.set(this.origin.x, this.origin.y);
    if ( s === 1 ) { this.pivot.set(0, 0); this.position.set(0, 0); }
  }
}

const sig = (d) => JSON.stringify([d.name, d.color, d.border, d.fill, d.revealed, d.rings, d.hover, d.fill === "dots" ? dotsCfg(d) : 0, look(d).ink, look(d).inkColor, look(d).inkOpacity, look(d).inkWidth, labelCfg(d)]);
/** Attributes and their display mode only rebuild the small attribute text, never the baked district. */
const asig = (d) => JSON.stringify([sceneConfig(canvas.scene).attrDisplay, attrsOf(d), d.color]);
const view = (id) => VIEWS.get(id);

/* ---- live drafts: a transient patch laid over a stored district, never written to the scene ---- */
const DRAFT = new Map();   // districtId -> patch. Resolution order: draft > per-district > scene default > built-in
const effective = (d) => { const p = DRAFT.get(d.id); return p ? { ...d, ...p } : d; };
const pendingIds = new Set();
let draftRaf = 0, draftTimer = 0, lastDraftRun = 0;
function runDrafts() {
  draftRaf = draftTimer = 0; lastDraftRun = performance.now();
  for ( const id of pendingIds ) refreshDistrict(id );
  pendingIds.clear();
}
/** At most one rebake per ~70 ms and per frame, only for the districts that changed. */
function scheduleDrafts() {
  if ( draftRaf || draftTimer ) return;
  const wait = 70 - (performance.now() - lastDraftRun);
  if ( wait > 8 ) draftTimer = setTimeout(() => { draftTimer = 0; draftRaf = requestAnimationFrame(runDrafts); }, wait);
  else draftRaf = requestAnimationFrame(runDrafts);
}
export function setDraft(id, patch) { DRAFT.set(id, patch); pendingIds.add(id); scheduleDrafts(); }
export function clearDraft(id) { if ( DRAFT.delete(id) ) { pendingIds.add(id); scheduleDrafts(); } }
/** Something scene-wide changed (a Scene Config draft): re-evaluate every district; unchanged ones are skipped by signature. */
export function refreshAllDistricts() { for ( const id of VIEWS.keys() ) pendingIds.add(id); scheduleDrafts(); }

function updateView(v, d) {
  v.data = d;
  if ( v.sig !== sig(d) ) return v.set(d, false);
  const a = asig(d);
  if ( v.asig !== a ) { v.asig = a; v.buildAttrs(); v.applyZoom(); }
  v.visible = canShow(d); v.applyHover();
}
function refreshDistrict(id) {
  if ( !layer || layer.destroyed ) return;
  const raw = (canvas.scene?.flags?.[MODULE_ID]?.[FLAG] ?? []).find((x) => x.id === id), v = VIEWS.get(id);
  if ( raw && v ) updateView(v, effective(raw));
}

function sync(animateNew = true) {
  if ( !layer || layer.destroyed ) return;
  const list = canvas.scene.flags?.[MODULE_ID]?.[FLAG] ?? [];
  const ids = new Set();
  for ( const raw of list ) {
    const d = effective(raw);
    ids.add(d.id);
    let v = VIEWS.get(d.id);
    if ( !v ) { v = new DistrictView(d, animateNew); VIEWS.set(d.id, v); layer.addChild(v); }
    else updateView(v, d);
  }
  for ( const [id, v] of [...VIEWS] ) if ( !ids.has(id) ) { v.destroy({ children: true, texture: true }); VIEWS.delete(id); }
  // later districts paint on top
  list.forEach((d, i) => { const v = VIEWS.get(d.id); if ( v ) layer.setChildIndex(v, Math.min(i, layer.children.length - 1)); });
}

const LIVE = new Set();   // open editor dialogs, closed when the canvas goes away so no draft can outlive its scene
/** Pan only when the whole district is outside the visible canvas. */
export function panIfOffscreen(id) {
  const v = VIEWS.get(id); if ( !v ) return;
  const b = v.bbox, t = canvas.stage.worldTransform, p0 = t.apply({ x: b.x0, y: b.y0 }), p1 = t.apply({ x: b.x1, y: b.y1 }), r = canvas.app.view.getBoundingClientRect();
  if ( p1.x < 0 || p1.y < 0 || p0.x > r.width || p0.y > r.height ) panToDistrict(id);
}
const readList = () => foundry.utils.deepClone(canvas.scene.flags?.[MODULE_ID]?.[FLAG] ?? []);
const save = async (list) => { const r = await canvas.scene.update({ [`flags.${MODULE_ID}.${FLAG}`]: list }); if ( game.user.isGM ) pruneStore(list); return r; };

/* ------------------------------------------------------------------ painting */

const opt = (k) => game.settings.get(MODULE_ID, k);
let stroke = null, lastMove = 0;

let lastPoint = null;
const brushActive = () => game.user.isGM && [PAINT, ERASE].includes(activeToolName());
const worldPoint = (ev) => canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY });
let brushDraft = null;   // live preview of the brush options dialog (size, colour)
const bopt = (k) => brushDraft?.[k] ?? opt(k);
const brushRadius = () => canvas.grid.size * bopt("districtSize") / 2;

function drawCursor(p) {
  if ( !cursor ) return;
  lastPoint = p;
  const erase = activeToolName() === ERASE, r = brushRadius();
  cursor.clear();
  cursor.lineStyle(Math.max(1.5, 2 / canvas.stage.scale.x), erase || isNone(bopt("districtColor")) ? 0xFFFFFF : Color.from(bopt("districtColor")), 0.95).drawCircle(p.x, p.y, r);
  cursor.lineStyle(Math.max(1, 1 / canvas.stage.scale.x), 0x15110F, 0.6).drawCircle(p.x, p.y, r + 2 / canvas.stage.scale.x);
  if ( erase ) cursor.lineStyle(0).beginFill(0xFFFFFF, 0.12).drawCircle(p.x, p.y, r).endFill();
}

function drawLive() {
  live.clear();
  if ( !stroke ) return;
  const col = stroke.erase || isNone(bopt("districtColor")) ? 0xFFFFFF : Color.from(bopt("districtColor"));
  live.lineStyle({ width: brushRadius() * 2, color: col, alpha: 1, join: PIXI.LINE_JOIN.ROUND, cap: PIXI.LINE_CAP.ROUND });
  const p = stroke.pts;
  live.moveTo(p[0][0], p[0][1]);
  if ( p.length === 1 ) live.lineTo(p[0][0] + 0.01, p[0][1]);
  for ( let i = 1; i < p.length; i++ ) live.lineTo(p[i][0], p[i][1]);
  live.alpha = stroke.erase ? 0.3 : 0.38;
}

function onDown(ev) {
  if ( ev.button !== 0 || !brushActive() || stroke ) return;
  if ( canvas.notes.hover || canvas.tokens.hover ) return;
  ev.stopImmediatePropagation(); ev.preventDefault();
  const p = worldPoint(ev);
  stroke = { pts: [[p.x, p.y]], erase: activeToolName() === ERASE };
  drawLive();
}
function onMove(ev) {
  const now = performance.now();
  if ( brushActive() ) {
    const p = worldPoint(ev); drawCursor(p); hideCard();
    if ( stroke ) {
      const last = stroke.pts.at(-1);
      if ( Math.hypot(p.x - last[0], p.y - last[1]) > brushRadius() * 0.25 ) { stroke.pts.push([p.x, p.y]); drawLive(); }
    }
    return;
  }
  cursor?.clear();
  if ( now - lastMove < 40 ) return;
  lastMove = now;
  hoverAt(ev);
}
async function onUp(ev) {
  if ( !stroke || ev.button !== 0 ) return;
  const s = stroke; stroke = null; live.clear();
  await commit(s);
}
function cancelStroke() { stroke = null; live?.clear(); }
const typing = (ev) => { const t = ev.target; return t instanceof HTMLElement && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName)); };

async function commit({ pts, erase }) {
  const r = brushRadius(), sp = strokePaths(pts, r), C = CL();
  const list = readList();
  const hit = (d) => boolean(C.ClipType.ctIntersection, d.rings.map(toPath), sp).length > 0;
  if ( erase ) {
    let changed = false;
    for ( const d of [...list] ) {
      if ( !hit(d) ) continue;
      const rings = finish(boolean(C.ClipType.ctDifference, d.rings.map(toPath), sp));
      changed = true;
      if ( rings.length ) d.rings = rings; else list.splice(list.indexOf(d), 1);
    }
    if ( changed ) await save(list);
    return;
  }
  let target = null;
  if ( opt("districtMerge") ) {
    const start = pts[0];
    target = [...list].reverse().find((d) => pointInRings(start[0], start[1], d.rings)) ?? [...list].reverse().find(hit);
  }
  if ( target ) {
    target.rings = finish(boolean(C.ClipType.ctUnion, target.rings.map(toPath), sp));
  } else {
    const rings = finish(sp);
    if ( !rings.length ) return;
    list.push({ id: foundry.utils.randomID(), name: "", color: sceneConfig(canvas.scene).districtNoColor ? "none" : opt("districtColor"), border: sceneConfig(canvas.scene).districtNoBorder ? "none" : opt("districtBorder"), fill: opt("districtFill"), ...(opt("districtFill") === "dots" ? { dots: opt("districtDots") } : {}),
      opacity: opt("districtOpacity"), ink: opt("districtInk"), inkColor: opt("districtInkColor"), inkOpacity: opt("districtInkOpacity"), inkWidth: opt("districtInkWidth"),
      hover: { mode: "inherit" }, revealed: false, rings });
  }
  await save(list);
}

/* ------------------------------------------------------------------ hover & edit */

let hovered = null, previewed = null;
function topAt(x, y) {
  const list = canvas.scene.flags?.[MODULE_ID]?.[FLAG] ?? [];
  for ( let i = list.length - 1; i >= 0; i-- ) {
    const d = list[i]; if ( !d.revealed && !game.user.isGM ) continue;
    const bb = bboxOf(d.rings);
    if ( x < bb.x0 || x > bb.x1 || y < bb.y0 || y > bb.y1 ) continue;
    if ( pointInRings(x, y, d.rings) ) return effective(d);
  }
  return null;
}
function hoverAt(ev) {
  let d = null;
  if ( !canvas.notes.hover && !canvas.tokens.hover && !brushActive() && VIEWS.size ) {
    const p = worldPoint(ev); d = topAt(p.x, p.y);
  }
  const id = d?.id ?? null;
  if ( id === hovered ) { if ( id ) moveCard(ev); return; }
  if ( hovered && hovered !== previewed ) view(hovered)?.setHover(false);
  hovered = id;
  if ( id ) { view(id)?.setHover(true); showCard(d, ev); } else hideCard();
  Hooks.callAll("moinenMapsDistrictHover", id);
}

function onDbl(ev) {
  if ( !game.user.isGM || brushActive() || canvas.notes.hover || canvas.tokens.hover ) return;
  const p = worldPoint(ev), d = topAt(p.x, p.y);
  if ( d ) openEditor(d.id);
}

export async function openEditor(id) {
  const d = readList().find((x) => x.id === id); if ( !d ) return;
  const L0 = look(d);
  const DialogV2 = foundry.applications.api.DialogV2;
  const sel = (name, val, opts) => `<select name="${name}">${opts.map(([v, l]) => `<option value="${v}"${v === val ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  let dlgRef = null, reopen = false, done = false;   // `done` stops a queued preview frame from re-applying a draft after the dialog ended
  const patchOf = (r, cur) => ({ name: r.name.trim(), color: r.pick || cur.color || "none", border: r.border, fill: r.fill,
    opacity: clamp(Number(r.opacity), 0, 1), ink: r.ink, inkColor: r.inkColor, inkOpacity: clamp(Number(r.inkOpacity), 0, 1), inkWidth: clamp(Number(r.inkWidth), 0.2, 4),
    revealed: !!r.revealed,
    label: r.lb_on ? { on: true, ...readLabelValues(r, "lb_") } : { on: false },
    hover: { mode: r.hmode, color: r.hcolor || cur.hover?.color || "" },
    dots: r.fill === "dots" ? readDotsValues(r, "dt_") : cur.dots });
  // live: every edit lays a draft over this one district (rebaked at most once per frame); nothing is written until Apply
  const preview = frameThrottle(() => {
    const form = dlgRef?.element?.querySelector("form"); if ( done || !form || !dlgRef.element.isConnected ) return;
    setDraft(id, { ...patchOf(readForm(form), d), _attrs: cleanAttrs(collectAttrs(form)) });
  });
  let result = null;
  try {
  panIfOffscreen(id); previewHover(id);   // the edited district glows with its own hover effect; the camera moves only if it is off screen
  result = await DialogV2.wait({
    window: { title: T("District.edit"), icon: "fa-solid fa-draw-polygon" }, classes: ["moinen-maps-dialog"], position: { width: 460 },
    content: `${liveBarHtml()}${fg(T("Editor.label"), `<input type="text" name="name" value="${esc(d.name)}" autofocus>`)}
      ${fgGroup(T("Editor.color"), swatchesHtml(d.color, false, true))}
      ${fg(T("District.border"), sel("border", d.border, [["solid", T("District.solid")], ["dashed", T("District.dashed")], ["none", T("District.borderNone")]]))}
      ${fg(T("District.fill"), sel("fill", d.fill, [["soft", T("District.soft")], ["hatch", T("District.hatch")], ["paper", T("District.paper")], ["dots", T("District.dots")]]))}
      <details class="mm-fold mm-dotsfold"${d.fill === "dots" ? " open" : ""}><summary>${esc(T("Dots.section"))}</summary><div class="mm-fold-body">${dotsFieldsHtml("dt_", dotsCfg(d))}</div></details>
      ${fg(T("District.opacity"), `<range-picker name="opacity" value="${L0.opacity}" min="0" max="1" step="0.05"></range-picker>`)}
      ${fg(T("District.revealed"), `<input type="checkbox" name="revealed"${d.revealed ? " checked" : ""}>`, T("District.revealedHint"))}
      <details class="mm-fold" open><summary>${esc(T("Attr.title"))}</summary><div class="mm-fold-body">${attrEditorHtml(attrsOf(d))}</div></details>
      <details class="mm-fold"><summary>${esc(T("District.inkSection"))}</summary><div class="mm-fold-body">
        ${fg(T("District.ink"), `${sel("ink", L0.ink, [["ink", T("District.inkDark")], ["match", T("District.inkMatch")], ["custom", T("District.inkCustom")]])}<color-picker name="inkColor" value="${esc(L0.inkColor)}"></color-picker>`)}
        ${fg(T("District.inkOpacity"), `<range-picker name="inkOpacity" value="${L0.inkOpacity}" min="0" max="1" step="0.05"></range-picker>`)}
        ${fg(T("District.inkWidth"), `<range-picker name="inkWidth" value="${L0.inkWidth}" min="0.2" max="4" step="0.1"></range-picker>`)}
      </div></details>
      <details class="mm-fold"><summary>${esc(T("Hover.section"))}</summary><div class="mm-fold-body">
        ${fg(T("Hover.mode"), sel("hmode", d.hover?.mode ?? "inherit", [["inherit", T("Hover.inherit")], ["none", T("Hover.none")], ["saturate", T("Hover.saturate")], ["highlight", T("Hover.highlight")], ["map", T("Hover.map")]]))}
        ${fg(T("Hover.color"), `<color-picker name="hcolor" value="${esc(d.hover?.color || "#ffd36b")}"></color-picker>`, T("Hover.colorHint"))}
      </div></details>
      <details class="mm-fold"><summary>${esc(T("Label.section"))}</summary><div class="mm-fold-body">
        ${fg(T("Label.override"), `<input type="checkbox" name="lb_on"${d.label?.on ? " checked" : ""}>`, T("Label.overrideHint"))}
        ${labelFieldsHtml("lb_", labelCfg(d))}
      </div></details>
      <input type="hidden" name="pick" value="${esc(d.color)}">`,
    render: (_e, dlg) => {
      const el = dlg.element; dlgRef = dlg; LIVE.add(dlg);
      wireLiveBar(el, () => { reopen = true; dlg.close(); });
      for ( const ev of ["input", "change", "click"] ) el.addEventListener(ev, preview);
      wireSwatches(el, el.querySelector('[name="pick"]'));
      wireFontPreview(el, "lb_"); wireAttrEditor(el); fitDialog(dlg);
      // the custom outline colour only matters when "custom" is chosen; the hover colour only for the highlight effect (or the scene default)
      const dep = (name, on) => { const x = el.querySelector(`[name="${name}"]`); if ( x ) { x.inert = !on; x.classList.toggle("is-off", !on); } };
      wireDotsFields(el, "dt_");
      const dotsFold = el.querySelector(".mm-dotsfold");
      const fillSel = el.querySelector('[name="fill"]');
      fillSel.addEventListener("change", () => { if ( fillSel.value === "dots" ) dotsFold.open = true; });
      const upd = () => { dotsFold.classList.toggle("is-off", fillSel.value !== "dots"); dotsFold.querySelector(".mm-fold-body").inert = fillSel.value !== "dots"; dep("inkColor", el.querySelector('[name="ink"]').value === "custom"); dep("hcolor", ["inherit", "highlight"].includes(el.querySelector('[name="hmode"]').value)); };
      el.addEventListener("change", upd); upd();
    },
    buttons: [
      { action: "save", label: T("Apply"), icon: "fa-solid fa-check", default: true, callback: (_e, b) => ({ ...readForm(b.form), attrs: collectAttrs(b.form) }) },
      { action: "delete", label: T("District.delete"), icon: "fa-solid fa-trash", callback: () => "delete" }
    ],
    rejectClose: false
  });
  if ( result ) {
    const list = readList(), cur = list.find((x) => x.id === id);
    if ( cur ) {
      if ( result === "delete" ) list.splice(list.indexOf(cur), 1);
      else Object.assign(cur, patchOf(result, cur));
      await save(list);   // a single update; the draft stays until it has landed, so the map does not flick back
      if ( result !== "delete" ) await writeAttrs(id, result.attrs);
    }
  }
  } finally {
    done = true; if ( dlgRef ) LIVE.delete(dlgRef);
    previewHover(null); clearDraft(id);   // cancel, Escape, close or error: back to the stored look
  }
  if ( reopen ) openEditor(id);
}

/** Brush options: size, colour, border and fill used by the next strokes. */
export async function openBrushOptions() {
  const DialogV2 = foundry.applications.api.DialogV2, cur = opt("districtColor");
  const sel = (name, val, opts) => `<select name="${name}">${opts.map(([v, l]) => `<option value="${v}"${v === val ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  let dlgRef = null, reopen = false, done = false;   // `done` stops a queued preview frame from re-applying a draft after the dialog ended
  const hadPoint = !!lastPoint;
  const showRing = () => { if ( cursor ) drawCursor(lastPoint ?? canvas.canvasCoordinatesFromClient({ x: innerWidth / 2, y: innerHeight / 2 })); };
  const preview = frameThrottle(() => {
    const form = dlgRef?.element?.querySelector("form"); if ( done || !form || !dlgRef.element.isConnected ) return;
    const f = readForm(form); brushDraft = { districtSize: clamp(Number(f.size) || 0.7, 0.2, 4), districtColor: f.pick || cur };
    showRing();   // the brush ring shows the size and colour the next strokes will have
  });
  try {
  await DialogV2.prompt({
    window: { title: T("District.brush"), icon: "fa-solid fa-paintbrush" }, classes: ["moinen-maps-dialog"], position: { width: 380 },
    content: `${liveBarHtml()}${fg(T("District.size"), `<range-picker name="size" value="${opt("districtSize")}" min="0.2" max="4" step="0.1"></range-picker>`, T("District.sizeHint"))}
      ${fgGroup(T("Editor.color"), swatchesHtml(cur, false, true))}
      ${fg(T("District.border"), sel("border", opt("districtBorder"), [["solid", T("District.solid")], ["dashed", T("District.dashed")], ["none", T("District.borderNone")]]))}
      ${fg(T("District.fill"), sel("fill", opt("districtFill"), [["soft", T("District.soft")], ["hatch", T("District.hatch")], ["paper", T("District.paper")], ["dots", T("District.dots")]]))}
      <details class="mm-fold"><summary>${esc(T("Dots.section"))}</summary><div class="mm-fold-body">${dotsFieldsHtml("bd_", dotsCfg({ dots: opt("districtDots") }))}</div></details>
      ${fg(T("District.opacity"), `<range-picker name="opacity" value="${opt("districtOpacity")}" min="0" max="1" step="0.05"></range-picker>`)}
      <details class="mm-fold"><summary>${esc(T("District.inkSection"))}</summary><div class="mm-fold-body">
        ${fg(T("District.ink"), `${sel("ink", opt("districtInk"), [["ink", T("District.inkDark")], ["match", T("District.inkMatch")], ["custom", T("District.inkCustom")]])}<color-picker name="inkColor" value="${esc(opt("districtInkColor"))}"></color-picker>`)}
        ${fg(T("District.inkOpacity"), `<range-picker name="inkOpacity" value="${opt("districtInkOpacity")}" min="0" max="1" step="0.05"></range-picker>`)}
        ${fg(T("District.inkWidth"), `<range-picker name="inkWidth" value="${opt("districtInkWidth")}" min="0.2" max="4" step="0.1"></range-picker>`)}
      </div></details>
      <input type="hidden" name="pick" value="${esc(cur)}">`,
    render: (_e, dlg) => {
      const el = dlg.element; dlgRef = dlg; LIVE.add(dlg);
      wireSwatches(el, el.querySelector('[name="pick"]')); fitDialog(dlg); wireDotsFields(el, "bd_");
      wireLiveBar(el, () => { reopen = true; dlg.close(); });
      for ( const ev of ["input", "change", "click"] ) el.addEventListener(ev, preview);
      preview();
    },
    ok: { label: T("Apply"), icon: "fa-solid fa-check", callback: async (_e, b) => {
      const f = readForm(b.form), set = (k, v) => game.settings.set(MODULE_ID, k, v);
      await set("districtSize", Number(f.size)); await set("districtColor", f.pick || cur);
      await set("districtBorder", f.border); await set("districtFill", f.fill); await set("districtDots", readDotsValues(f, "bd_"));
      await set("districtOpacity", clamp(Number(f.opacity), 0, 1)); await set("districtInk", f.ink); await set("districtInkColor", f.inkColor);
      await set("districtInkOpacity", clamp(Number(f.inkOpacity), 0, 1)); await set("districtInkWidth", clamp(Number(f.inkWidth), 0.2, 4));
    } },
    rejectClose: false
  });
  } finally {
    done = true; if ( dlgRef ) LIVE.delete(dlgRef);
    brushDraft = null;
    if ( cursor ) { if ( brushActive() && hadPoint && lastPoint ) drawCursor(lastPoint ); else { cursor.clear(); if ( !hadPoint ) lastPoint = null; } }
  }
  if ( reopen ) openBrushOptions();
}

export async function clearDistricts() {
  const n = readList().length;
  if ( !n ) return ui.notifications.info(T("District.none"));
  const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: T("Tool.districtClear") }, content: `<p>${esc(game.i18n.format("MOINENMAPS.District.clearConfirm", { n }))}</p>` });
  if ( ok ) await save([]);
}

/* ------------------------------------------------------------------ lifecycle */

export function registerDistrictSettings() {
  const S = game.settings;
  S.register(MODULE_ID, "districtSize", { scope: "client", config: false, type: Number, default: 0.7, onChange: () => { if ( lastPoint && brushActive() ) drawCursor(lastPoint); } });
  S.register(MODULE_ID, "districtColor", { scope: "client", config: false, type: String, default: PIN_COLORS[3] });
  S.register(MODULE_ID, "districtBorder", { scope: "client", config: false, type: String, default: "solid" });
  S.register(MODULE_ID, "districtFill", { scope: "client", config: false, type: String, default: "soft" });
  S.register(MODULE_ID, "districtDots", { scope: "client", config: false, type: Object, default: {} });
  S.register(MODULE_ID, "districtOpacity", { scope: "client", config: false, type: Number, default: 0.8 });
  S.register(MODULE_ID, "districtInk", { scope: "client", config: false, type: String, default: "ink" });
  S.register(MODULE_ID, "districtInkColor", { scope: "client", config: false, type: String, default: "#15110f" });
  S.register(MODULE_ID, "districtInkOpacity", { scope: "client", config: false, type: Number, default: 0.95 });
  S.register(MODULE_ID, "districtInkWidth", { scope: "client", config: false, type: Number, default: 1 });
  S.register(MODULE_ID, "districtMerge", { scope: "client", config: false, type: Boolean, default: true });
}

let listeners = null;
export function onCanvasReady() {
  teardown();
  layer = new PIXI.Container(); layer.zIndex = 700; layer.eventMode = "none"; layer.sortableChildren = false;
  live = new PIXI.Graphics(); cursor = new PIXI.Graphics(); cursor.eventMode = "none"; cursor.zIndex = 900;
  // districts live in the primary group, between the scene background and tiles/drawings/tokens (sorted by elevation, sortLayer)
  Object.assign(layer, { elevation: 0, sortLayer: 250, sort: 0, _lastSortedIndex: 0 });
  canvas.primary.addChild(layer);
  // cursor ring and live stroke are UI feedback, above everything
  const host = canvas.interface; host.sortableChildren = true;
  host.addChild(cursor); host.addChild(live); live.zIndex = 899;
  sync(false);
  const view_ = canvas.app.view;
  listeners = {
    down: (e) => onDown(e), move: (e) => onMove(e), up: (e) => onUp(e), dbl: (e) => onDbl(e),
    fonts: () => { for ( const v of VIEWS.values() ) v.refreshLabel(); },
    leave: () => { cursor?.clear(); lastPoint = null; hideCard(); if ( hovered ) { view(hovered)?.setHover(false); hovered = null; Hooks.callAll("moinenMapsDistrictHover", null); } },
    cancel: () => cancelStroke(),
    key: (e) => {
      if ( e.key === "Escape" && stroke ) { cancelStroke(); e.preventDefault(); e.stopPropagation(); }
      else if ( brushActive() && !typing(e) && !e.ctrlKey && !e.metaKey && (e.key === "[" || e.key === "]") ) {
        const v = clamp(opt("districtSize") + (e.key === "]" ? 0.1 : -0.1), 0.2, 4);
        game.settings.set(MODULE_ID, "districtSize", Math.round(v * 10) / 10);
      }
    }
  };
  view_.addEventListener("pointerdown", listeners.down, true);
  view_.addEventListener("pointermove", listeners.move);
  window.addEventListener("pointerup", listeners.up);
  window.addEventListener("pointercancel", listeners.cancel);   // a lost gesture must not leave a stroke stuck to the cursor
  window.addEventListener("blur", listeners.cancel);
  view_.addEventListener("dblclick", listeners.dbl);
  view_.addEventListener("pointerleave", listeners.leave);
  window.addEventListener("keydown", listeners.key, true);
  document.fonts.addEventListener("loadingdone", listeners.fonts);
}

export function teardown() {
  if ( listeners ) {
    const v = canvas.app?.view;
    v?.removeEventListener("pointerdown", listeners.down, true); v?.removeEventListener("pointermove", listeners.move);
    v?.removeEventListener("dblclick", listeners.dbl); v?.removeEventListener("pointerleave", listeners.leave);
    document.fonts.removeEventListener("loadingdone", listeners.fonts);
    window.removeEventListener("pointerup", listeners.up); window.removeEventListener("keydown", listeners.key, true);
    window.removeEventListener("pointercancel", listeners.cancel); window.removeEventListener("blur", listeners.cancel);
    listeners = null;
  }
  for ( const v of VIEWS.values() ) if ( !v.destroyed ) v.destroy({ children: true, texture: true });
  for ( const dlg of [...LIVE] ) dlg.close();
  LIVE.clear(); DRAFT.clear(); pendingIds.clear(); brushDraft = null;
  clearTimeout(draftTimer); if ( draftRaf ) cancelAnimationFrame(draftRaf); draftRaf = draftTimer = 0;
  VIEWS.clear(); destroyCard();
  if ( ticking ) { canvas.app?.ticker?.remove(sharedTick); ticking = false; }
  for ( const o of [layer, cursor, live] ) if ( o && !o.destroyed ) o.destroy({ children: true });
  layer = cursor = live = null; hovered = previewed = lastPoint = null; stroke = null;
}

export function onUpdateSceneDistricts(scene, changed) {
  if ( scene.id !== canvas.scene?.id ) return;
  if ( foundry.utils.hasProperty(changed, `flags.${MODULE_ID}`) ) { sync(true); for ( const v of VIEWS.values() ) v.applyHover(); Hooks.callAll("moinenMapsDistrictsChanged"); }
}

export function onCanvasPan() { for ( const v of VIEWS.values() ) { v.applyZoom(); v.checkRes(); } }
export const _dbg = () => ({ stroke, listeners: !!listeners, layer: !!layer, brush: brushActive(), tool: activeToolName() });
export const _commit = (s) => commit(s);
export const _dbg2 = { finish, strokePaths, simplifyRing, fromPath };

/* ------------------------------------------------------------------ API used by the districts panel */

/** The attribute store changed (GM only): refresh attribute text on the map and let the panel resync. */
export function onAttrStoreChanged() { sync(false); Hooks.callAll("moinenMapsDistrictsChanged"); }
export const listDistricts = () => readList();
export const saveDistricts = (list) => save(list);
export const isLocalHidden = (id) => LOCAL_HIDDEN.has(id);
export function setLocalHidden(id, on) {
  on ? LOCAL_HIDDEN.add(id) : LOCAL_HIDDEN.delete(id);
  const v = VIEWS.get(id); if ( v ) v.visible = canShow(v.data);
}
/** Mirror a panel row hover on the canvas, reusing the normal hover effect. */
export function previewHover(id) {
  if ( previewed && previewed !== id && previewed !== hovered ) VIEWS.get(previewed)?.setHover(false);
  previewed = id;
  if ( id ) VIEWS.get(id)?.setHover(true);
}
export function panToDistrict(id) {
  const v = VIEWS.get(id); if ( !v ) return;
  const b = v.bbox, w = b.x1 - b.x0, h = b.y1 - b.y0, r = canvas.dimensions.rect;
  const scale = clamp(Math.min(window.innerWidth * 0.45 / Math.max(w, 1), window.innerHeight * 0.55 / Math.max(h, 1)), 0.25, 2.5);
  void r;
  return canvas.animatePan({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, scale, duration: 450 });
}
/** Flash a district: hover on, then off again unless something still hovers it. */
export function pulseDistrict(id) {
  const v = VIEWS.get(id); if ( !v ) return;
  v.setHover(true);
  setTimeout(() => { if ( hovered !== id && previewed !== id ) v.setHover(false); }, 900);
}
