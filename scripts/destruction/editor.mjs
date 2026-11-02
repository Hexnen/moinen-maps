import { MODULE_ID } from "../config.mjs";
import * as Model from "./model.mjs";
import { trackMarkers } from "../workspace/markers.mjs";
import { pickToken, classifyPress, OVER_KEYS } from "../tokens/carry-core.mjs";
import * as Front from "../tokens/carry-front.mjs";

/**
 * Painting the damage (GM): a brush and an eraser on the mask grid, a ring cursor and a translucent overlay of the mask (amber =
 * cracked, orange = broken, red = crater) while a tool is in hand. Strokes edit the mask at once; the bake and the save follow a
 * moment after the last stroke. Shift while painting deepens what is there by one level per stroke (layered passes).
 * Keys: [ ] brush size, 1 2 3 level, Shift+0..9 cause (0: the scene default), , . previous / next cause, Ctrl+Z undo, Ctrl+Shift+Z / Ctrl+Y redo, Escape
 * cancels the stroke.
 * CARRY A TOKEN: a stroke whose first pointer-down lands on a token and that is then DRAGGED carries the token along its path (the
 * stroke keeps the token and the path: tokens/carry-core.mjs, destruction.mjs edited). Armed by Ctrl held at the pointer-down (left
 * button), or by the "carry token" latch (setting destrCarry) where Ctrl then does the opposite. A click does nothing special.
 */
const OVERLAY = [null, [242, 193, 78], [239, 138, 58], [224, 69, 58]];
let mode = null;               // "paint" | "erase" | null
let host = null;               // the engine: { state(), ensureState(), edited(box), tellBrush() }
let cursor = null, overlay = null, overlayCtx = null, overlayImg = null, overlayTex = null, listeners = null;
let dirty = null, flushing = false;   // overlay pixels changed since the last upload (mask px box), uploaded once per frame
let stroke = null, lastPoint = null;
let ctrlDown = false, cueToken = null;          // Ctrl is held (read from pointer and key events), the token under the brush while armed
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
  // carry a token with the stroke: the latch (Ctrl at the pointer-down does the opposite), where the token ends, grid snapping of the end
  game.settings.register(MODULE_ID, "destrCarry", { scope: "client", config: false, type: Boolean, default: false, onChange: f });
  game.settings.register(MODULE_ID, "carryEnds", { name: "MOINENMAPS.Destr.carryEnds", hint: "MOINENMAPS.Destr.carryEndsHint", scope: "client", config: true, type: String, default: "real",
    choices: { real: "MOINENMAPS.Destr.carryEndsReal", return: "MOINENMAPS.Destr.carryEndsReturn" }, onChange: f });
  game.settings.register(MODULE_ID, "carrySnap", { name: "MOINENMAPS.Destr.carrySnap", hint: "MOINENMAPS.Destr.carrySnapHint", scope: "client", config: true, type: Boolean, default: false, onChange: f });
}

/** Is carrying armed for a stroke that begins with Ctrl `ctrl`? The latch XOR Ctrl; only in the paint tool. */
export const carryArmed = (ctrl, m = mode) => m === "paint" && (!!opt("destrCarry", false) !== !!ctrl);
export const carryOptions = () => ({ ends: opt("carryEnds", "real") === "return" ? "return" : "real", snap: !!opt("carrySnap", false) });

/** The token under a scene point (the topmost one this client sees and that is not locked), or null. Reuses its rows. */
const rows = [];
export function tokenAt(p) {
  const list = canvas.tokens?.placeables; if ( !list?.length ) return null;
  let n = 0;
  for ( const t of list ) {
    const d = t.document; if ( !d || t.destroyed ) continue;
    const r = rows[n] ??= {};
    r.id = d.id; r.x = t.x; r.y = t.y; r.w = t.w; r.h = t.h; r.elevation = d.elevation ?? 0; r.sort = d.sort ?? 0; r.locked = !!d.locked; r.visible = !!t.visible && t.renderable !== false;
    n++;
  }
  rows.length = n;
  const id = pickToken(rows, p);
  return id ? canvas.tokens.get(id) : null;
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
  // armed to carry a token: a cyan ring around the token under the brush, or a small token glyph at the brush when none is
  if ( !erase && !stroke && carryArmed(ctrlDown) ) {
    const t = cueToken && !cueToken.destroyed ? cueToken : null, u = 1 / z;
    if ( t ) {
      cursor.lineStyle(Math.max(2, 3 * u), 0x6FE0FF, 0.95).drawCircle(t.center.x, t.center.y, Math.max(t.w, t.h) / 2 + 3 * u);
      cursor.lineStyle(Math.max(1, u), 0x15110F, 0.6).drawCircle(t.center.x, t.center.y, Math.max(t.w, t.h) / 2 + 5 * u);
    }
    const gx = p.x + r + 10 * u, gy = p.y - r - 10 * u;
    cursor.lineStyle(Math.max(1.5, 2 * u), 0x6FE0FF, t ? 1 : 0.55).beginFill(0x6FE0FF, t ? 0.45 : 0.12).drawCircle(gx, gy, 6 * u).endFill();
    cursor.lineStyle(Math.max(1.5, 2 * u), 0x6FE0FF, t ? 1 : 0.55).moveTo(gx + 9 * u, gy).lineTo(gx + 17 * u, gy).lineTo(gx + 13 * u, gy - 3 * u).moveTo(gx + 17 * u, gy).lineTo(gx + 13 * u, gy + 3 * u);
  } else if ( stroke?.grab ) {
    const t = canvas.tokens?.get(stroke.grab.id);
    if ( t && !t.destroyed ) cursor.lineStyle(Math.max(2, 3 / z), 0x6FE0FF, 0.6).drawCircle(t.center.x, t.center.y, Math.max(t.w, t.h) / 2 + 3 / z);
  }
}

/**
 * Where the overlay and the brush cursor live: on the interface above everything (zIndex `z`), or - while a carried token is in front
 * (underTokens) - in the primary group just under the tokens (carry-core OVER_KEYS), so the token is never covered by the hatch or the ring.
 */
let under = false;
function seat(o, z) {
  if ( !o || o.destroyed ) return;
  if ( under && canvas.primary ) { Object.assign(o, { ...OVER_KEYS, _lastSortedIndex: 0 }); canvas.primary.addChild(o); canvas.primary.sortDirty = true; }
  else { o.zIndex = z; canvas.interface.sortableChildren = true; canvas.interface.addChild(o); }
}
/** A carry is running (or about to): the overlay and the cursor go under the tokens; false puts them back on top. */
export function underTokens(on) { on = !!on; if ( on === under ) return; under = on; seat(overlay, 800); seat(cursor, 900); }
Front.onUnder(underTokens);
export const _overlays = () => [overlay, cursor].filter((o) => o && !o.destroyed);

function buildOverlay() {
  destroyOverlay();
  const S = host?.state(); if ( !S || !canvas.interface ) return;
  const c = document.createElement("canvas"); c.width = S.mw; c.height = S.mh;
  overlayCtx = c.getContext("2d");
  overlayImg = overlayCtx.createImageData(S.mw, S.mh);
  // mipmapped: the one-pixel hatch would shimmer when zoomed out (sampling follows the zoom, see overlayFilter)
  overlayTex = PIXI.Texture.from(c, { scaleMode: PIXI.SCALE_MODES.NEAREST, mipmap: PIXI.MIPMAP_MODES.ON });
  overlay = new PIXI.Sprite(overlayTex);
  overlay.eventMode = "none";
  const r = Model.sceneRect();
  overlay.position.set(r.x, r.y); overlay.scale.set(S.mpx);
  seat(overlay, 800);
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
  // (heard on the window in the capture phase, BEFORE the canvas's own listeners: PIXI's event system sits on the canvas element, and
  // a press that began a stroke must not also select or drag the token under it - least of all a token that is being carried)
  if ( ev.button !== 0 || !mode || stroke || ev.target !== canvas.app?.view ) return;
  ev.stopImmediatePropagation(); ev.preventDefault();
  const S = host.ensureState();
  if ( !overlay ) buildOverlay();
  const p = worldPoint(ev);
  // the stroke is painted into a buffer of its own (it becomes a stroke object at the end); the overlay shows it on the composite
  stroke = { last: p, first: p, changed: false, box: null, deepen: ev.shiftKey, touched: new Set(), t0: performance.now(), path: [[p.x, p.y, 0]],
    buf: { mask: new Uint8Array(S.mw * S.mh), mw: S.mw, mh: S.mh, mpx: S.mpx }, before: S.mask.slice(),
    down: { x: ev.clientX, y: ev.clientY }, maxD: 0, grab: null };
  // armed (Ctrl held at the pointer-down XOR the latch) and a token under the brush: remember it (a drag will carry it)
  if ( carryArmed(ev.ctrlKey) ) {
    const t = tokenAt(p);
    if ( t ) { stroke.grab = { id: t.document.id, x0: t.document.x, y0: t.document.y, w: t.w, h: t.h }; Front.hold(t.document.id, "grab"); }   // in front from the press on
  }
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
  ctrlDown = ev.ctrlKey;
  cueToken = !stroke && carryArmed(ctrlDown) ? tokenAt(p) : null;
  drawCursor(p);
  if ( stroke ) {
    stroke.maxD = Math.max(stroke.maxD, Math.hypot(ev.clientX - stroke.down.x, ev.clientY - stroke.down.y));
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
  // the grabbed token stays in front: a carry takes the hold over when its entry starts (a bake may wait a while), else it is let go
  const carries = !!s.grab && s.changed && mode === "paint" && classifyPress(s.maxD, performance.now() - s.t0) === "drag";
  if ( s.grab ) Front.release(s.grab.id, "grab", carries ? 8000 : 0);
  if ( !s.changed ) return;
  const end = s.path[s.path.length - 1];
  if ( end[0] !== s.last.x || end[1] !== s.last.y ) s.path.push([s.last.x, s.last.y, Math.round(performance.now() - s.t0)]);
  const buf = s.buf.mask; for ( let i = 0; i < buf.length; i++ ) if ( buf[i] ) buf[i] = Model.levelOf(buf[i]);
  // a press that began on a token and was dragged carries it (a click is a plain stroke)
  const carry = s.grab && mode === "paint" && classifyPress(s.maxD, performance.now() - s.t0) === "drag" ? { grab: s.grab, ...carryOptions() } : null;
  host.edited(s.box, { buf, a: s.first, b: s.last, path: s.path, erase: mode === "erase", type: brush().type, cause: brush().cause, carry });
}

/** Undo: the last stroke object goes, nothing else changes. */
function undoStroke() {
  if ( stroke ) return;
  host?.undo?.();                 // (it redraws the overlay inside the undone stroke's box)
}

/** Redo: the stroke the last undo took back comes again. */
function redoStroke() {
  if ( stroke ) return;
  host?.redo?.();
}

const typing = (ev) => { const t = ev.target; return t instanceof HTMLElement && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName)); };

/* ---------------------------------------------------------------- lifecycle */

export function onCanvasReady() {
  teardown();
  if ( !game.user.isGM ) return;
  cursor = new PIXI.Graphics(); cursor.eventMode = "none";
  seat(cursor, 900);
  trackMarkers(cursor, { ring: true });
  const view = canvas.app.view;
  listeners = {
    down: onDown, move: onMove, up: onUp,
    cancel: () => endStroke(),
    ctl: (e) => {      // Ctrl pressed or let go over the canvas: the carry cue follows (only the cursor; nothing else reads it)
      if ( e.key !== "Control" || !mode || stroke || ctrlDown === (e.type === "keydown") ) return;
      ctrlDown = e.type === "keydown";
      if ( lastPoint ) { cueToken = carryArmed(ctrlDown) ? tokenAt(lastPoint) : null; drawCursor(lastPoint); }
    },
    pan: () => overlayFilter(),
    leave: () => { cursor?.clear(); lastPoint = null; },
    key: (e) => {
      if ( typing(e) ) return;
      const ours = e.target instanceof Element && !!e.target.closest?.(".mm-d-actions, [data-tool^='mm-d'], [data-act='detonate']");
      const k = e.key.toLowerCase();
      if ( (e.ctrlKey || e.metaKey) && !e.altKey && (k === "z" || k === "y") && (mode || ours) ) { e.preventDefault(); e.stopPropagation(); if ( k === "y" || e.shiftKey ) redoStroke(); else undoStroke(); return; }
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
  window.addEventListener("pointerdown", listeners.down, true);
  view.addEventListener("pointermove", listeners.move);
  view.addEventListener("pointerleave", listeners.leave);
  window.addEventListener("pointerup", listeners.up);
  window.addEventListener("pointercancel", listeners.cancel);
  window.addEventListener("blur", listeners.cancel);
  window.addEventListener("keydown", listeners.key, true);
  window.addEventListener("keydown", listeners.ctl); window.addEventListener("keyup", listeners.ctl);
  listeners.panId = Hooks.on("canvasPan", listeners.pan);
  if ( mode ) buildOverlay();
}

export function teardown() {
  if ( listeners ) {
    const v = canvas.app?.view;
    window.removeEventListener("pointerdown", listeners.down, true); v?.removeEventListener("pointermove", listeners.move);
    v?.removeEventListener("pointerleave", listeners.leave);
    window.removeEventListener("pointerup", listeners.up); window.removeEventListener("pointercancel", listeners.cancel);
    window.removeEventListener("blur", listeners.cancel); window.removeEventListener("keydown", listeners.key, true);
    window.removeEventListener("keydown", listeners.ctl); window.removeEventListener("keyup", listeners.ctl);
    Hooks.off("canvasPan", listeners.panId);
    listeners = null;
  }
  destroyOverlay();
  if ( cursor && !cursor.destroyed ) cursor.destroy({ children: true });
  cursor = null; stroke = null; lastPoint = null; undo.length = 0; cueToken = null; ctrlDown = false;
}
