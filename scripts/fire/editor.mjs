import { MODULE_ID } from "../config.mjs";
import { trackMarkers } from "../workspace/markers.mjs";
import * as Fire from "./fire.mjs";

/**
 * Painting FIRE AND SMOKE (GM): a fire brush, a smoke brush and an eraser of this layer. A stroke shows at once while painted (a
 * draft) and is stored as one stroke object at the pointer-up. Keys while a tool is in hand: [ ] brush size, Ctrl+Z undo,
 * Ctrl+Shift+Z / Ctrl+Y redo, Escape ends the stroke. Client settings: fireBrush (grid squares), fireStrength, fireWind, fireWindDir.
 */
const RING = { fire: 0xff8a24, smoke: 0x9a948c, erase: 0xffffff };
let mode = null;            // "fire" | "smoke" | "erase" | null
let cursor = null, listeners = null, stroke = null, lastPoint = null;

const opt = (k, d) => { try { return game.settings.get(MODULE_ID, k); } catch { return d; } };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function registerFireSettings(onChange) {
  const f = () => { if ( lastPoint && mode ) drawCursor(lastPoint); onChange?.(); };
  game.settings.register(MODULE_ID, "fireBrush", { scope: "client", config: false, type: Number, default: 1.5, onChange: f });
  game.settings.register(MODULE_ID, "fireStrength", { scope: "client", config: false, type: Number, default: 0.8, onChange: f });
  game.settings.register(MODULE_ID, "fireWind", { scope: "client", config: false, type: Number, default: 0.3, onChange: f });
  game.settings.register(MODULE_ID, "fireWindDir", { scope: "client", config: false, type: Number, default: 0, onChange: f });
}

export const brush = () => ({
  size: clamp(Number(opt("fireBrush", 1.5)) || 1.5, 0.25, 10),
  strength: clamp(Number(opt("fireStrength", 0.8)) || 0.8, 0.1, 1),
  wind: clamp(Number(opt("fireWind", 0.3)) || 0, 0, 1),
  windDir: ((Number(opt("fireWindDir", 0)) || 0) % 360 + 360) % 360
});
const radius = () => canvas.grid.size * brush().size / 2;
const worldPoint = (ev) => canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY });
export const getMode = () => mode;

export function setMode(m) {
  if ( !game.user.isGM ) m = null;
  if ( m === mode ) return;
  if ( stroke ) endStroke(true);
  mode = m;
  if ( !mode ) { cursor?.clear(); lastPoint = null; }
}

function drawCursor(p) {
  if ( !cursor ) return;
  lastPoint = p;
  const r = radius(), z = canvas.stage.scale.x, c = RING[mode] ?? 0xffffff;
  cursor.clear();
  cursor.lineStyle(Math.max(1.5, 2 / z), c, 0.95).drawCircle(p.x, p.y, r);
  cursor.lineStyle(Math.max(1, 1 / z), 0x15110F, 0.6).drawCircle(p.x, p.y, r + 2 / z);
  if ( mode === "erase" ) cursor.lineStyle(0).beginFill(0xFFFFFF, 0.12).drawCircle(p.x, p.y, r).endFill();
  else if ( brush().wind > 0 ) {
    // the wind: an arrow from the ring's centre, as long as the wind is strong
    const b = brush(), a = b.windDir * Math.PI / 180, L = r * (0.4 + 0.6 * b.wind), ex = p.x + Math.cos(a) * L, ey = p.y + Math.sin(a) * L, h = Math.max(6 / z, L * 0.18);
    cursor.lineStyle(Math.max(1.5, 2 / z), 0xdff0ff, 0.8).moveTo(p.x, p.y).lineTo(ex, ey)
      .moveTo(ex, ey).lineTo(ex - Math.cos(a - 0.5) * h, ey - Math.sin(a - 0.5) * h).moveTo(ex, ey).lineTo(ex - Math.cos(a + 0.5) * h, ey - Math.sin(a + 0.5) * h);
  }
}

function strokeOf(s) {
  const b = brush();
  return { k: mode, r: Math.round(radius()), s: mode === "erase" ? 1 : b.strength, wd: b.windDir, ws: mode === "erase" ? 0 : b.wind, p: s.pts.flat(), q: s.q };
}

function onDown(ev) {
  if ( ev.button !== 0 || !mode || stroke || ev.target !== canvas.app?.view ) return;
  ev.stopImmediatePropagation(); ev.preventDefault();
  const p = worldPoint(ev);
  stroke = { pts: [[Math.round(p.x), Math.round(p.y)]], q: undefined };
  Fire.setDraft(strokeOf(stroke));
}

function onMove(ev) {
  if ( !mode ) { cursor?.clear(); return; }
  const p = worldPoint(ev);
  drawCursor(p);
  if ( !stroke ) return;
  const q = stroke.pts[stroke.pts.length - 1];
  // a point every quarter of the radius (at least 4 px): the stored path stays small
  if ( Math.hypot(p.x - q[0], p.y - q[1]) >= Math.max(4, radius() * 0.25) ) { stroke.pts.push([Math.round(p.x), Math.round(p.y)]); Fire.setDraft(strokeOf(stroke)); }
}

function endStroke(cancel = false) {
  if ( !stroke ) return;
  const s = stroke; stroke = null;
  Fire.setDraft(null);
  if ( cancel ) return;
  Fire.add(strokeOf(s));
}

const typing = (ev) => { const t = ev.target; return t instanceof HTMLElement && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName)); };

export function onCanvasReady() {
  teardown();
  if ( !game.user.isGM ) return;
  cursor = new PIXI.Graphics(); cursor.eventMode = "none"; cursor.zIndex = 900;
  canvas.interface.sortableChildren = true; canvas.interface.addChild(cursor);
  trackMarkers(cursor, { ring: true });
  const view = canvas.app.view;
  listeners = {
    down: onDown, move: onMove,
    up: (e) => { if ( e.button === 0 ) endStroke(); },
    cancel: () => endStroke(),
    leave: () => { cursor?.clear(); lastPoint = null; },
    key: (e) => {
      if ( typing(e) ) return;
      const ours = e.target instanceof Element && !!e.target.closest?.("[data-tool^='mm-fire'], .mm-fire-panel");
      const k = e.key.toLowerCase();
      if ( (e.ctrlKey || e.metaKey) && !e.altKey && (k === "z" || k === "y") && (mode || ours) ) {
        e.preventDefault(); e.stopPropagation();
        if ( stroke ) return;
        if ( k === "y" || e.shiftKey ) Fire.redo(); else Fire.undo();
        return;
      }
      if ( !mode ) return;
      if ( e.key === "Escape" && stroke ) { e.preventDefault(); e.stopPropagation(); endStroke(true); }
      else if ( !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "[" || e.key === "]") ) {
        e.preventDefault(); e.stopPropagation();
        game.settings.set(MODULE_ID, "fireBrush", Math.round(clamp(brush().size + (e.key === "]" ? 0.25 : -0.25), 0.25, 10) * 4) / 4);
      }
    }
  };
  window.addEventListener("pointerdown", listeners.down, true);
  view.addEventListener("pointermove", listeners.move);
  view.addEventListener("pointerleave", listeners.leave);
  window.addEventListener("pointerup", listeners.up);
  window.addEventListener("pointercancel", listeners.cancel);
  window.addEventListener("blur", listeners.cancel);
  window.addEventListener("keydown", listeners.key, true);
}

export function teardown() {
  if ( listeners ) {
    const v = canvas.app?.view;
    window.removeEventListener("pointerdown", listeners.down, true); v?.removeEventListener("pointermove", listeners.move);
    v?.removeEventListener("pointerleave", listeners.leave);
    window.removeEventListener("pointerup", listeners.up); window.removeEventListener("pointercancel", listeners.cancel);
    window.removeEventListener("blur", listeners.cancel); window.removeEventListener("keydown", listeners.key, true);
    listeners = null;
  }
  if ( cursor && !cursor.destroyed ) cursor.destroy();
  cursor = null; stroke = null; lastPoint = null;
}
