import { MODULE_ID } from "../config.mjs";
import * as Model from "./model.mjs";

/**
 * Painting the damage (GM): a brush and an eraser on the mask grid, a ring cursor and a translucent overlay of the mask (amber =
 * cracked, orange = broken, red = crater) while a tool is in hand. Strokes edit the mask at once; the bake and the save follow a
 * moment after the last stroke. Shift while painting deepens what is there by one level per stroke (layered passes).
 * Keys: [ ] brush size, 1 2 3 level, Ctrl+Z undo, Escape cancels the stroke.
 */
const OVERLAY = [null, [242, 193, 78], [239, 138, 58], [224, 69, 58]];
const UNDO_MAX = 30;
let mode = null;               // "paint" | "erase" | null
let host = null;               // the engine: { state(), ensureState(), edited(box), tellBrush() }
let cursor = null, overlay = null, overlayCtx = null, overlayImg = null, overlayTex = null, listeners = null;
let stroke = null, lastPoint = null;
const undo = [];

const opt = (k, d) => { try { return game.settings.get(MODULE_ID, k); } catch { return d; } };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function registerEditorSettings(onChange) {
  const f = () => { if ( lastPoint && mode ) drawCursor(lastPoint); onChange?.(); };
  game.settings.register(MODULE_ID, "destrBrush", { scope: "client", config: false, type: Number, default: 1.5, onChange: f });
  game.settings.register(MODULE_ID, "destrLevel", { scope: "client", config: false, type: Number, default: 3, onChange: f });
  game.settings.register(MODULE_ID, "destrType", { scope: "client", config: false, type: Number, default: 0, onChange: f });
}

export const brush = () => ({
  size: clamp(Number(opt("destrBrush", 1.5)) || 1.5, 0.25, 10),
  level: clamp(Math.round(Number(opt("destrLevel", 3)) || 3), 1, 3),
  type: clamp(Math.round(Number(opt("destrType", 0)) || 0), 0, Model.TYPES.length - 1)
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
  overlayTex = PIXI.Texture.from(c, { scaleMode: PIXI.SCALE_MODES.NEAREST });
  overlayTex.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
  overlay = new PIXI.Sprite(overlayTex);
  overlay.eventMode = "none"; overlay.zIndex = 800;
  const r = Model.sceneRect();
  overlay.position.set(r.x, r.y); overlay.scale.set(S.mpx);
  canvas.interface.sortableChildren = true;
  canvas.interface.addChild(overlay);
  paintOverlay(null);
}

function destroyOverlay() {
  if ( overlay && !overlay.destroyed ) overlay.destroy({ children: true });
  overlayTex?.destroy(true);
  overlay = overlayCtx = overlayImg = overlayTex = null;
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
  overlayCtx.putImageData(overlayImg, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  overlayTex.baseTexture.update();
}

export function refreshOverlay() {
  const S = host?.state();
  if ( !mode ) return;
  if ( !S || !overlayImg || overlayImg.width !== S.mw || overlayImg.height !== S.mh ) buildOverlay(); else paintOverlay(null);
}

/* ---------------------------------------------------------------- strokes */

function onDown(ev) {
  if ( ev.button !== 0 || !mode || stroke ) return;
  ev.stopImmediatePropagation(); ev.preventDefault();
  const S = host.ensureState();
  if ( !overlay ) buildOverlay();
  undo.push({ mask: S.mask.slice(), mw: S.mw });
  if ( undo.length > UNDO_MAX ) undo.shift();
  const p = worldPoint(ev);
  stroke = { last: p, changed: false, box: null, deepen: ev.shiftKey, touched: new Set() };
  paint(p, p);
}

function paint(a, b) {
  const S = host.state(); if ( !S || !stroke ) return;
  const r = radius(), br = brush();
  const step = Math.max(1, Math.min(r, S.mpx * 2) * 0.5);
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
  const opts = { mode: mode === "erase" ? "erase" : stroke.deepen ? "deepen" : "raise", level: br.level, type: br.type, touched: stroke.touched };
  let box = null;
  for ( let i = 1; i <= n; i++ ) {
    const hit = Model.stamp(S, a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n, r, opts);
    if ( hit ) box = box ? { x0: Math.min(box.x0, hit.x0), y0: Math.min(box.y0, hit.y0), x1: Math.max(box.x1, hit.x1), y1: Math.max(box.y1, hit.y1) } : hit;
  }
  if ( box ) {
    stroke.changed = true;
    stroke.box = stroke.box ? { x0: Math.min(stroke.box.x0, box.x0), y0: Math.min(stroke.box.y0, box.y0), x1: Math.max(stroke.box.x1, box.x1), y1: Math.max(stroke.box.y1, box.y1) } : box;
    paintOverlay(box);
  }
}

function onMove(ev) {
  if ( !mode ) { cursor?.clear(); return; }
  const p = worldPoint(ev);
  drawCursor(p);
  if ( stroke ) { paint(stroke.last, p); stroke.last = p; }
}

function onUp(ev) { if ( ev.button === 0 ) endStroke(); }

function endStroke() {
  if ( !stroke ) return;
  const s = stroke; stroke = null;
  if ( s.changed ) host.edited(s.box); else undo.pop();
}

function undoStroke() {
  const S = host?.state(), u = undo.pop();
  if ( !S || !u || u.mw !== S.mw || u.mask.length !== S.mask.length ) return;
  const before = S.mask.slice();
  S.mask.set(u.mask);
  paintOverlay(null);
  host.edited(Model.diffBox(before, S.mask, S.mw));
}

const typing = (ev) => { const t = ev.target; return t instanceof HTMLElement && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName)); };

/* ---------------------------------------------------------------- lifecycle */

export function onCanvasReady() {
  teardown();
  if ( !game.user.isGM ) return;
  cursor = new PIXI.Graphics(); cursor.eventMode = "none"; cursor.zIndex = 900;
  canvas.interface.sortableChildren = true;
  canvas.interface.addChild(cursor);
  const view = canvas.app.view;
  listeners = {
    down: onDown, move: onMove, up: onUp,
    cancel: () => endStroke(),
    leave: () => { cursor?.clear(); lastPoint = null; },
    key: (e) => {
      if ( !mode || typing(e) ) return;
      if ( (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" ) { e.preventDefault(); e.stopPropagation(); undoStroke(); }
      else if ( e.key === "Escape" && stroke ) { e.preventDefault(); e.stopPropagation(); endStroke(); }
      else if ( !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "[" || e.key === "]") ) {
        const v = clamp(brush().size + (e.key === "]" ? 0.25 : -0.25), 0.25, 10);
        game.settings.set(MODULE_ID, "destrBrush", Math.round(v * 4) / 4);
      } else if ( !e.ctrlKey && !e.metaKey && !e.altKey && mode === "paint" && /^[123]$/.test(e.key) ) {
        e.preventDefault(); e.stopPropagation();
        game.settings.set(MODULE_ID, "destrLevel", Number(e.key));
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
  if ( mode ) buildOverlay();
}

export function teardown() {
  if ( listeners ) {
    const v = canvas.app?.view;
    v?.removeEventListener("pointerdown", listeners.down, true); v?.removeEventListener("pointermove", listeners.move);
    v?.removeEventListener("pointerleave", listeners.leave);
    window.removeEventListener("pointerup", listeners.up); window.removeEventListener("pointercancel", listeners.cancel);
    window.removeEventListener("blur", listeners.cancel); window.removeEventListener("keydown", listeners.key, true);
    listeners = null;
  }
  destroyOverlay();
  if ( cursor && !cursor.destroyed ) cursor.destroy({ children: true });
  cursor = null; stroke = null; lastPoint = null; undo.length = 0;
}
