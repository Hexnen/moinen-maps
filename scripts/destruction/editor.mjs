import { MODULE_ID } from "../config.mjs";
import * as Model from "./model.mjs";
import { trackMarkers } from "../workspace/markers.mjs";

/**
 * Painting the damage (GM): a brush and an eraser on the mask grid, a ring cursor and a translucent overlay of the mask (amber =
 * cracked, orange = broken, red = crater) while a tool is in hand. Strokes edit the mask at once; the bake and the save follow a
 * moment after the last stroke. Shift while painting deepens what is there by one level per stroke (layered passes).
 * Keys: [ ] brush size, 1 2 3 level, Shift+0..9 cause (0: the scene default), , . previous / next cause, Ctrl+Z undo, Escape
 * cancels the stroke.
 */
const OVERLAY = [null, [242, 193, 78], [239, 138, 58], [224, 69, 58]];
let mode = null;               // "paint" | "erase" | null
let host = null;               // the engine: { state(), ensureState(), edited(box), tellBrush() }
let cursor = null, overlay = null, overlayCtx = null, overlayImg = null, overlayTex = null, listeners = null;
let dirty = null, flushing = false;   // overlay pixels changed since the last upload (mask px box), uploaded once per frame
let stroke = null, lastPoint = null;
const undo = [];

const opt = (k, d) => { try { return game.settings.get(MODULE_ID, k); } catch { return d; } };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function registerEditorSettings(onChange) {
  const f = () => { if ( lastPoint && mode ) drawCursor(lastPoint); onChange?.(); };
  game.settings.register(MODULE_ID, "destrBrush", { scope: "client", config: false, type: Number, default: 1.5, onChange: f });
  game.settings.register(MODULE_ID, "destrLevel", { scope: "client", config: false, type: Number, default: 3, onChange: f });
  game.settings.register(MODULE_ID, "destrType", { scope: "client", config: false, type: Number, default: 0, onChange: f });
  // the brush's cause: 0 = the scene's default (the stroke stores none)
  game.settings.register(MODULE_ID, "destrCause", { scope: "client", config: false, type: Number, default: 0, onChange: f });
}

export const brush = () => ({
  size: clamp(Number(opt("destrBrush", 1.5)) || 1.5, 0.25, 10),
  level: clamp(Math.round(Number(opt("destrLevel", 3)) || 3), 1, 3),
  type: clamp(Math.round(Number(opt("destrType", 0)) || 0), 0, Model.TYPES.length - 1),
  cause: Model.causeOf(opt("destrCause", 0))
});
const radius = () => canvas.grid.size * brush().size / 2;
const worldPoint = (ev) => canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY });

export function bindHost(h) { host = h; }
export const getMode = () => mode;

export function setMode(m) {
  if ( !game.user.isGM ) m = null;
  if ( m === mode ) return;
  mode = m;
  document.body.classList.toggle("mm-painting-destruction", !!mode);
  if ( mode ) { if ( !overlay ) buildOverlay(); }
  else { cursor?.clear(); destroyOverlay(); lastPoint = null; stroke = null; }
}

/* ---------------------------------------------------------------- cursor and overlay */

function drawCursor(p) {
  if ( !cursor ) return;
  lastPoint = p;
  const erase = mode === "erase", r = radius(), z = canvas.stage.scale.x;
  const rgb = erase ? [255, 255, 255] : OVERLAY[brush().level];
  const color = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
  cursor.clear();
  cursor.lineStyle(Math.max(1.5, 2 / z), color, 0.95).drawCircle(p.x, p.y, r);
  cursor.lineStyle(Math.max(1, 1 / z), 0x15110F, 0.6).drawCircle(p.x, p.y, r + 2 / z);
  if ( erase ) cursor.lineStyle(0).beginFill(0xFFFFFF, 0.12).drawCircle(p.x, p.y, r).endFill();
}

function buildOverlay() {
  destroyOverlay();
  const S = host?.state(); if ( !S || !canvas.interface ) return;
  const c = document.createElement("canvas"); c.width = S.mw; c.height = S.mh;
  overlayCtx = c.getContext("2d");
  overlayImg = overlayCtx.createImageData(S.mw, S.mh);
  // mipmapped: the one-pixel hatch would shimmer when zoomed out (sampling follows the zoom, see overlayFilter)
  overlayTex = PIXI.Texture.from(c, { scaleMode: PIXI.SCALE_MODES.NEAREST, mipmap: PIXI.MIPMAP_MODES.ON });
  overlay = new PIXI.Sprite(overlayTex);
  overlay.eventMode = "none"; overlay.zIndex = 800;
  const r = Model.sceneRect();
  overlay.position.set(r.x, r.y); overlay.scale.set(S.mpx);
  canvas.interface.sortableChildren = true;
  canvas.interface.addChild(overlay);
  trackMarkers(overlay);
  overlayFilter();
  paintOverlay(null);
}

/** Crisp when a mask pixel covers 2+ screen pixels, smooth (mipmapped) below. */
function overlayFilter() {
  const S = host?.state(); if ( !overlayTex || !S || !canvas.stage ) return;
  const want = canvas.stage.scale.x * S.mpx >= 2 ? PIXI.SCALE_MODES.NEAREST : PIXI.SCALE_MODES.LINEAR;
  if ( overlayTex.baseTexture.scaleMode !== want ) overlayTex.baseTexture.scaleMode = want;
}

function destroyOverlay() {
  if ( overlay && !overlay.destroyed ) overlay.destroy({ children: true });
  overlayTex?.destroy(true);
  overlay = overlayCtx = overlayImg = overlayTex = null;
  dirty = null;
}

/** Upload the changed part of the overlay at most once per frame (pointer moves can come faster than frames). */
function scheduleFlush() {
  if ( flushing ) return;
  flushing = true;
  canvas.app.ticker.addOnce(flush, null, PIXI.UPDATE_PRIORITY.HIGH);
}
function flush() {
  flushing = false;
  if ( !dirty || !overlayCtx ) { dirty = null; return; }
  const b = dirty; dirty = null;
  overlayCtx.putImageData(overlayImg, 0, 0, b.x0, b.y0, b.x1 - b.x0 + 1, b.y1 - b.y0 + 1);
  overlayTex.baseTexture.update();
}

/** Only the outline and a light hatch of the mask, so the baked result stays readable under it. */
function paintOverlay(box) {
  const S = host?.state(); if ( !S || !overlayImg ) return;
  const x0 = Math.max(0, (box?.x0 ?? 0) - 1), y0 = Math.max(0, (box?.y0 ?? 0) - 1), x1 = Math.min(S.mw - 1, (box?.x1 ?? S.mw - 1) + 1), y1 = Math.min(S.mh - 1, (box?.y1 ?? S.mh - 1) + 1);
  const d = overlayImg.data, m = S.mask, W = S.mw;
  const lv = (x, y) => (x < 0 || y < 0 || x >= W || y >= S.mh) ? 0 : m[y * W + x] & 3;
  for ( let y = y0; y <= y1; y++ ) for ( let x = x0; x <= x1; x++ ) {
    const o = (y * W + x) * 4, l = lv(x, y);
    if ( !l ) { d[o + 3] = 0; continue; }
    const edge = lv(x - 1, y) < l || lv(x + 1, y) < l || lv(x, y - 1) < l || lv(x, y + 1) < l;
    const c = OVERLAY[l];
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2];
    d[o + 3] = edge ? 220 : ((x + y) % 4 === 0 ? 90 : 0);
  }
  dirty = dirty ? { x0: Math.min(dirty.x0, x0), y0: Math.min(dirty.y0, y0), x1: Math.max(dirty.x1, x1), y1: Math.max(dirty.y1, y1) } : { x0, y0, x1, y1 };
  scheduleFlush();
}

/** Draw the overlay again after a change outside a stroke (undo, load): inside `box` (mask px) when only that changed, else all of it. */
export function refreshOverlay(box = null) {
  const S = host?.state();
  if ( !mode ) return;
  if ( !S || !overlayImg || overlayImg.width !== S.mw || overlayImg.height !== S.mh ) buildOverlay(); else paintOverlay(box);
}

/* ---------------------------------------------------------------- strokes */

function onDown(ev) {
  if ( ev.button !== 0 || !mode || stroke ) return;
  ev.stopImmediatePropagation(); ev.preventDefault();
  const S = host.ensureState();
  if ( !overlay ) buildOverlay();
  const p = worldPoint(ev);
  // the stroke is painted into a buffer of its own (it becomes a stroke object at the end); the overlay shows it on the composite
  stroke = { last: p, first: p, changed: false, box: null, deepen: ev.shiftKey, touched: new Set(), t0: performance.now(), path: [[p.x, p.y, 0]],
    buf: { mask: new Uint8Array(S.mw * S.mh), mw: S.mw, mh: S.mh, mpx: S.mpx }, before: S.mask.slice() };
  paint(p, p);
}

function paint(a, b) {
  const S = host.state(); if ( !S || !stroke ) return;
  const r = radius(), br = brush();
  const step = Math.max(1, Math.min(r, S.mpx * 2) * 0.5);
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
  const erase = mode === "erase";
  const opts = { mode: "raise", level: erase ? 1 : br.level, type: br.type };
  let box = null;
  for ( let i = 1; i <= n; i++ ) {
    const hit = Model.stamp(stroke.buf, a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n, r, opts);
    if ( hit ) box = box ? { x0: Math.min(box.x0, hit.x0), y0: Math.min(box.y0, hit.y0), x1: Math.max(box.x1, hit.x1), y1: Math.max(box.y1, hit.y1) } : hit;
  }
  if ( box ) {
    stroke.changed = true;
    stroke.box = stroke.box ? { x0: Math.min(stroke.box.x0, box.x0), y0: Math.min(stroke.box.y0, box.y0), x1: Math.max(stroke.box.x1, box.x1), y1: Math.max(stroke.box.y1, box.y1) } : box;
    // the composite shows the stroke on top at once (Shift: one level deeper than what was there)
    const m = stroke.buf.mask, W = S.mw;
    for ( let y = box.y0; y <= box.y1; y++ ) for ( let x = box.x0; x <= box.x1; x++ ) {
      const i = y * W + x; if ( !m[i] ) continue;
      if ( stroke.deepen && !erase ) m[i] = Model.byteOf(Math.min(3, Model.levelOf(stroke.before[i]) + 1), br.type);
      S.mask[i] = erase ? 0 : Model.byteOf(Model.levelOf(m[i]), br.type);
    }
    paintOverlay(box);
  }
}

function onMove(ev) {
  if ( !mode ) { cursor?.clear(); return; }
  const p = worldPoint(ev);
  drawCursor(p);
  if ( stroke ) {
    paint(stroke.last, p); stroke.last = p;
    // the stroke's path (scene px, ms since the start), thinned to a point every few pixels
    const q = stroke.path[stroke.path.length - 1];
    if ( Math.hypot(p.x - q[0], p.y - q[1]) >= Math.max(4, radius() * 0.25) ) stroke.path.push([p.x, p.y, Math.round(performance.now() - stroke.t0)]);
  }
}

function onUp(ev) { if ( ev.button === 0 ) endStroke(); }

function endStroke() {
  if ( !stroke ) return;
  const s = stroke; stroke = null;
  if ( !s.changed ) return;
  const end = s.path[s.path.length - 1];
  if ( end[0] !== s.last.x || end[1] !== s.last.y ) s.path.push([s.last.x, s.last.y, Math.round(performance.now() - s.t0)]);
  const buf = s.buf.mask; for ( let i = 0; i < buf.length; i++ ) if ( buf[i] ) buf[i] = Model.levelOf(buf[i]);
  host.edited(s.box, { buf, a: s.first, b: s.last, path: s.path, erase: mode === "erase", type: brush().type, cause: brush().cause });
}

/** Undo: the last stroke object goes, nothing else changes. */
function undoStroke() {
  if ( stroke ) return;
  host?.undo?.();                 // (it redraws the overlay inside the undone stroke's box)
}

const typing = (ev) => { const t = ev.target; return t instanceof HTMLElement && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName)); };

/* ---------------------------------------------------------------- lifecycle */

export function onCanvasReady() {
  teardown();
  if ( !game.user.isGM ) return;
  cursor = new PIXI.Graphics(); cursor.eventMode = "none"; cursor.zIndex = 900;
  canvas.interface.sortableChildren = true;
  canvas.interface.addChild(cursor);
  trackMarkers(cursor, { ring: true });
  const view = canvas.app.view;
  listeners = {
    down: onDown, move: onMove, up: onUp,
    cancel: () => endStroke(),
    pan: () => overlayFilter(),
    leave: () => { cursor?.clear(); lastPoint = null; },
    key: (e) => {
      if ( typing(e) ) return;
      const ours = e.target instanceof Element && !!e.target.closest?.(".mm-d-actions, [data-tool^='mm-d'], [data-act='detonate']");
      if ( (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z" && (mode || ours) ) { e.preventDefault(); e.stopPropagation(); undoStroke(); return; }
      if ( !mode ) return;
      if ( e.key === "Escape" && stroke ) { e.preventDefault(); e.stopPropagation(); endStroke(); }
      else if ( !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "[" || e.key === "]") ) {
        const v = clamp(brush().size + (e.key === "]" ? 0.25 : -0.25), 0.25, 10);
        game.settings.set(MODULE_ID, "destrBrush", Math.round(v * 4) / 4);
      } else if ( !e.ctrlKey && !e.metaKey && !e.altKey && mode === "paint" && /^[123]$/.test(e.key) ) {
        e.preventDefault(); e.stopPropagation();
        game.settings.set(MODULE_ID, "destrLevel", Number(e.key));
      } else if ( !e.ctrlKey && !e.metaKey && !e.altKey && mode === "paint" && e.shiftKey && /^Digit[0-9]$/.test(e.code) ) {
        // the cause: Shift+1..9, Shift+0 = the scene default (by key position, whatever the keyboard layout prints)
        e.preventDefault(); e.stopPropagation();
        game.settings.set(MODULE_ID, "destrCause", Math.min(Model.CAUSES.length - 1, Number(e.code.slice(5))));
      } else if ( !e.ctrlKey && !e.metaKey && !e.altKey && mode === "paint" && (e.key === "," || e.key === ".") ) {
        // , . step through the causes
        e.preventDefault(); e.stopPropagation();
        const n = Model.CAUSES.length;
        game.settings.set(MODULE_ID, "destrCause", (brush().cause + (e.key === "." ? 1 : n - 1)) % n);
      }
    }
  };
  view.addEventListener("pointerdown", listeners.down, true);
  view.addEventListener("pointermove", listeners.move);
  view.addEventListener("pointerleave", listeners.leave);
  window.addEventListener("pointerup", listeners.up);
  window.addEventListener("pointercancel", listeners.cancel);
  window.addEventListener("blur", listeners.cancel);
  window.addEventListener("keydown", listeners.key, true);
  listeners.panId = Hooks.on("canvasPan", listeners.pan);
  if ( mode ) buildOverlay();
}

export function teardown() {
  if ( listeners ) {
    const v = canvas.app?.view;
    v?.removeEventListener("pointerdown", listeners.down, true); v?.removeEventListener("pointermove", listeners.move);
    v?.removeEventListener("pointerleave", listeners.leave);
    window.removeEventListener("pointerup", listeners.up); window.removeEventListener("pointercancel", listeners.cancel);
    window.removeEventListener("blur", listeners.cancel); window.removeEventListener("keydown", listeners.key, true);
    Hooks.off("canvasPan", listeners.panId);
    listeners = null;
  }
  destroyOverlay();
  if ( cursor && !cursor.destroyed ) cursor.destroy({ children: true });
  cursor = null; stroke = null; lastPoint = null; undo.length = 0;
}
