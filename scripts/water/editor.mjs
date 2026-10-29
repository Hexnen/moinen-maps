import { MODULE_ID } from "../config.mjs";
import * as Model from "./model.mjs";
import * as Water from "./water.mjs";
import { activeToolName } from "../tools.mjs";

/**
 * Painting the water's masks (GM): three brush tools (still water, river, fall) and an eraser, a ring cursor and a translucent
 * overlay of the masks while one of the tools is active. Strokes edit the masks directly (so painting is instant); the bake and the
 * save follow a moment after the last stroke.
 */

export const WATER_TOOLS = { "mm-w-water": "water", "mm-w-river": "river", "mm-w-fall": "fall", "mm-w-erase": null };
const OVERLAY = { water: [47, 134, 214], river: [70, 208, 208], fall: [255, 255, 255] };
const UNDO_MAX = 12;

const T = (k) => game.i18n.localize(`MOINENMAPS.${k}`);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const opt = (k) => game.settings.get(MODULE_ID, k);

let cursor = null, overlay = null, overlayCtx = null, overlayImg = null, overlayTex = null, listeners = null;
let stroke = null, lastPoint = null;
const undo = [];

export function registerWaterEditorSettings() {
  game.settings.register(MODULE_ID, "waterBrush", { scope: "client", config: false, type: Number, default: 1.5, onChange: () => { if ( lastPoint && active() ) drawCursor(lastPoint); } });
}

const active = () => game.user.isGM && activeToolName() in WATER_TOOLS;
const layerOf = () => WATER_TOOLS[activeToolName()];
export const brushRadius = () => canvas.grid.size * opt("waterBrush") / 2;
const worldPoint = (ev) => canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY });

/* ---------------------------------------------------------------- cursor and overlay */

function drawCursor(p) {
  if ( !cursor ) return;
  lastPoint = p;
  const erase = layerOf() === null, r = brushRadius(), z = canvas.stage.scale.x;
  const rgb = erase ? [255, 255, 255] : OVERLAY[layerOf()];
  const color = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
  cursor.clear();
  cursor.lineStyle(Math.max(1.5, 2 / z), color, 0.95).drawCircle(p.x, p.y, r);
  cursor.lineStyle(Math.max(1, 1 / z), 0x15110F, 0.6).drawCircle(p.x, p.y, r + 2 / z);
  if ( erase ) cursor.lineStyle(0).beginFill(0xFFFFFF, 0.12).drawCircle(p.x, p.y, r).endFill();
}

function buildOverlay() {
  destroyOverlay();
  const S = Water.state(); if ( !S ) return;
  const c = document.createElement("canvas"); c.width = S.w; c.height = S.h;
  overlayCtx = c.getContext("2d");
  overlayImg = overlayCtx.createImageData(S.w, S.h);
  overlayTex = PIXI.Texture.from(c, { scaleMode: PIXI.SCALE_MODES.NEAREST });
  overlayTex.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
  overlay = new PIXI.Sprite(overlayTex);
  overlay.eventMode = "none"; overlay.zIndex = 800;
  const r = Model.sceneRect();
  overlay.position.set(r.x, r.y); overlay.scale.set(S.px);
  canvas.interface.sortableChildren = true;
  canvas.interface.addChild(overlay);
  paintOverlay(null);
}

function destroyOverlay() {
  if ( overlay && !overlay.destroyed ) overlay.destroy({ children: true });
  overlayTex?.destroy(true);
  overlay = overlayCtx = overlayImg = overlayTex = null;
}

/** Repaint the overlay inside a box of art pixels (all of it when null). */
function paintOverlay(box) {
  const S = Water.state(); if ( !S || !overlayImg ) return;
  const x0 = box?.x0 ?? 0, y0 = box?.y0 ?? 0, x1 = box?.x1 ?? S.w - 1, y1 = box?.y1 ?? S.h - 1;
  const d = overlayImg.data, m = S.masks;
  for ( let y = y0; y <= y1; y++ ) for ( let x = x0; x <= x1; x++ ) {
    const i = y * S.w + x, o = i * 4;
    // later layers lie on top: the fall over the river over still water
    const l = m.fall[i] ? "fall" : m.river[i] ? "river" : m.water[i] ? "water" : null;
    if ( l ) { const c = OVERLAY[l]; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 120; } else d[o + 3] = 0;
  }
  overlayCtx.putImageData(overlayImg, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  overlayTex.baseTexture.update();
}

/** Show or hide the overlay and ring to match the active tool. */
export function syncTool() {
  const on = active();
  document.body.classList.toggle("mm-painting-water", on);
  if ( on ) {
    if ( !overlay ) buildOverlay();
  } else { cursor?.clear(); destroyOverlay(); lastPoint = null; }
}

/* ---------------------------------------------------------------- strokes */

async function onDown(ev) {
  if ( ev.button !== 0 || !active() || stroke ) return;
  ev.stopImmediatePropagation(); ev.preventDefault();
  const S = await Water.ensureState();
  if ( !overlay ) buildOverlay();
  const layer = layerOf();
  // a snapshot of what this stroke may change, for undo
  const names = layer ? [layer] : Model.LAYERS;
  undo.push({ rev: S.rev, px: S.px, layers: Object.fromEntries(names.map((n) => [n, S.masks[n].slice()])) });
  if ( undo.length > UNDO_MAX ) undo.shift();
  const p = worldPoint(ev);
  stroke = { last: p, changed: false };
  paint(p, p);
}

function paint(a, b) {
  const S = Water.state(); if ( !S ) return;
  const layer = layerOf(), r = brushRadius();
  const step = Math.max(1, Math.min(r, S.px * 2) * 0.5);
  const dist = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(dist / step));
  let box = null;
  for ( let i = 1; i <= n; i++ ) {
    const x = a.x + (b.x - a.x) * i / n, y = a.y + (b.y - a.y) * i / n;
    const hit = layer ? stampOver(S, layer, x, y, r) : stampErase(S, x, y, r);
    if ( hit ) {
      box = box ? { x0: Math.min(box.x0, hit.x0), y0: Math.min(box.y0, hit.y0), x1: Math.max(box.x1, hit.x1), y1: Math.max(box.y1, hit.y1) } : hit;
    }
  }
  if ( box ) { stroke.changed = true; paintOverlay(box); }
}

/** Paint a layer: the others keep their paint underneath (the engine itself lets the fall win over the river over the water). */
function stampOver(S, layer, x, y, r) { return Model.stamp(S, layer, x, y, r, true); }

function stampErase(S, x, y, r) {
  let box = null;
  for ( const l of Model.LAYERS ) {
    const hit = Model.stamp(S, l, x, y, r, false);
    if ( hit ) box = box ? { x0: Math.min(box.x0, hit.x0), y0: Math.min(box.y0, hit.y0), x1: Math.max(box.x1, hit.x1), y1: Math.max(box.y1, hit.y1) } : hit;
  }
  return box;
}

function onMove(ev) {
  if ( !active() ) { cursor?.clear(); return; }
  const p = worldPoint(ev);
  drawCursor(p);
  if ( stroke ) { paint(stroke.last, p); stroke.last = p; }
}

function onUp(ev) {
  if ( !stroke || ev.button !== 0 ) return;
  const s = stroke; stroke = null;
  if ( s.changed ) Water.edited(); else undo.pop();
}

function cancelStroke() { if ( stroke ) { stroke = null; Water.edited(); } }

/** Ctrl+Z while a water tool is active: back one stroke. */
function undoStroke() {
  const S = Water.state(), u = undo.pop();
  if ( !S || !u || u.px !== S.px ) return;
  for ( const [n, data] of Object.entries(u.layers) ) S.masks[n].set(data);
  paintOverlay(null);
  Water.edited();
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
    down: onDown, move: onMove, up: onUp, cancel: cancelStroke,
    leave: () => { cursor?.clear(); lastPoint = null; },
    key: (e) => {
      if ( !active() || typing(e) ) return;
      if ( (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" ) { e.preventDefault(); e.stopPropagation(); undoStroke(); }
      else if ( e.key === "Escape" && stroke ) { cancelStroke(); e.preventDefault(); e.stopPropagation(); }
      else if ( !e.ctrlKey && !e.metaKey && (e.key === "[" || e.key === "]") ) {
        const v = clamp(opt("waterBrush") + (e.key === "]" ? 0.25 : -0.25), 0.25, 8);
        game.settings.set(MODULE_ID, "waterBrush", Math.round(v * 4) / 4);
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
  Hooks.on("moinenMapsWater", onWaterEvent);
}

function onWaterEvent(kind) {
  // masks were replaced (another set loaded, the grid resampled, cleared): rebuild the overlay
  if ( kind === "loaded" || kind === "edited" ) { if ( overlay && !stroke ) { const S = Water.state(); if ( !S || overlayImg?.width !== S.w || overlayImg?.height !== S.h ) buildOverlay(); else paintOverlay(null); } }
}

export function teardown() {
  if ( listeners ) {
    const v = canvas.app?.view;
    v?.removeEventListener("pointerdown", listeners.down, true); v?.removeEventListener("pointermove", listeners.move);
    v?.removeEventListener("pointerleave", listeners.leave);
    window.removeEventListener("pointerup", listeners.up); window.removeEventListener("pointercancel", listeners.cancel);
    window.removeEventListener("blur", listeners.cancel); window.removeEventListener("keydown", listeners.key, true);
    listeners = null;
    Hooks.off("moinenMapsWater", onWaterEvent);
  }
  destroyOverlay();
  if ( cursor && !cursor.destroyed ) cursor.destroy({ children: true });
  cursor = null; stroke = null; lastPoint = null; undo.length = 0;
  document.body.classList.remove("mm-painting-water");
}
