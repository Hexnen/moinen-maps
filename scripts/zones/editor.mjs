import { smoothStroke } from "../roads/graph.mjs";
import { trackMarkers } from "../workspace/markers.mjs";
import * as Zones from "./zones.mjs";

/**
 * Drawing zones (GM): a pencil and an eraser.
 *  - pencil: drag to draw a line freely; hold Shift for a straight line. Lines may overshoot and cross: whatever area they close off is
 *    a zone. An end that stops just short of a line is joined to it (the scene's "join gaps" distance).
 *  - eraser: drag over lines to rub them out.
 * Keys: Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y) undo / redo, [ and ] the eraser size, Escape drops the line being drawn.
 * The raw pencil lines are drawn only while the Zones section is open; elsewhere only the finished zones show (display.mjs).
 * Real pointer events on the canvas view, caught in the capture phase so the active layer does not also act on them.
 */

let mode = null;
let gfx = null, lines = null, listeners = null;
let press = null;          // { sx, sy, raw: [...], drag }
let trail = null;          // eraser trail
let cursorAt = null, shiftDown = false;

const g = () => Zones.gridSize();
const zoom = () => canvas.stage.scale.x;
const worldPoint = (ev) => canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY });
const eraserR = () => (Math.min(4, Math.max(0.1, Number(Zones.setting("zonesEraser", 0.5)) || 0.5)) * g()) / 2;
const typing = (ev) => { const t = ev.target; return t instanceof HTMLElement && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName)); };

export const currentMode = () => mode;

/** "draw", "erase" or null. */
export function setMode(m) {
  m = m === "draw" || m === "erase" ? m : null;
  if ( m && !game.user.isGM ) return;
  if ( m === mode ) return;
  mode = m; press = null; trail = null;
  document.body.classList.toggle("mm-painting-zones", !!mode);
  redraw();
}

function ensureGfx() {
  if ( lines && !lines.destroyed ) return;
  canvas.interface.sortableChildren = true;
  lines = new PIXI.Graphics(); lines.eventMode = "none"; lines.zIndex = 795;   // under the pins (notes, 800)
  gfx = new PIXI.Graphics(); gfx.eventMode = "none"; gfx.zIndex = 861;
  canvas.interface.addChild(lines); canvas.interface.addChild(gfx);
  trackMarkers(lines); trackMarkers(gfx, { ring: true });
}

function trace(G, p) { G.moveTo(p[0], p[1]); for ( let i = 2; i < p.length; i += 2 ) G.lineTo(p[i], p[i + 1]); }

/** The pencil lines (raw, with everything that sticks out) - only inside the Zones section. */
function drawLines() {
  if ( !lines || lines.destroyed ) return;
  lines.clear();
  const S = Zones.state();
  if ( !S || !Zones.editing() ) return;
  const z = zoom();
  for ( const [w, c, a] of [[4.5 / z, 0xffffff, 0.45], [2 / z, 0x2b2622, 0.95]] ) {
    lines.lineStyle({ width: w, color: c, alpha: a, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
    for ( const p of S.strokes.values() ) trace(lines, p);
  }
}

export function redraw() {
  drawLines();
  if ( !gfx || gfx.destroyed ) return;
  gfx.clear();
  if ( !mode || !cursorAt || !Zones.editing() ) return;
  const z = zoom();
  if ( mode === "erase" ) {
    const r = eraserR();
    if ( trail?.length >= 4 ) { gfx.lineStyle({ width: r * 2, color: 0xe5322d, alpha: 0.25, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND }); trace(gfx, trail); }
    gfx.lineStyle({ width: 2 / z, color: 0xffffff, alpha: 0.95 }).drawCircle(cursorAt.x, cursorAt.y, r);
    gfx.lineStyle({ width: 1 / z, color: 0x15110f, alpha: 0.6 }).drawCircle(cursorAt.x, cursorAt.y, r + 2 / z);
    return;
  }
  // the line being drawn, and the pencil's tip
  if ( press?.drag && press.raw.length >= 4 ) {
    const p = shiftDown ? [press.raw[0], press.raw[1], cursorAt.x, cursorAt.y] : press.raw;
    gfx.lineStyle({ width: 4.5 / z, color: 0xffffff, alpha: 0.5, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND }); trace(gfx, p);
    gfx.lineStyle({ width: 2 / z, color: 0x2b2622, alpha: 1, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND }); trace(gfx, p);
  }
  gfx.lineStyle({ width: 1.5 / z, color: 0x15110f, alpha: 0.9 }).beginFill(0xf3e7c9, 1).drawCircle(cursorAt.x, cursorAt.y, 3.5 / z).endFill();
  // how far an end reaches to join a nearby line
  const S = Zones.state(), snap = (S?.snap ?? 0) * g();
  if ( snap > 0 ) gfx.lineStyle({ width: 1 / z, color: 0xf3e7c9, alpha: 0.5 }).drawCircle(cursorAt.x, cursorAt.y, snap);
}

/* ---------------------------------------------------------------- pointer handling */

function onDown(ev) {
  if ( !mode || !Zones.editing() ) return;
  if ( ev.button !== 0 ) return;
  ev.stopImmediatePropagation(); ev.preventDefault();
  const p = worldPoint(ev);
  cursorAt = p;
  if ( mode === "erase" ) { trail = [p.x, p.y]; redraw(); return; }
  press = { sx: ev.clientX, sy: ev.clientY, raw: [p.x, p.y], drag: false };
}

function onMove(ev) {
  if ( !mode ) return;
  const p = worldPoint(ev);
  cursorAt = p; shiftDown = ev.shiftKey;
  if ( mode === "erase" && trail ) {
    const lx = trail[trail.length - 2], ly = trail[trail.length - 1];
    if ( Math.hypot(p.x - lx, p.y - ly) > 2 / zoom() ) trail.push(p.x, p.y);
  } else if ( press ) {
    if ( !press.drag && Math.hypot(ev.clientX - press.sx, ev.clientY - press.sy) > 4 ) press.drag = true;
    if ( press.drag ) {
      const lx = press.raw[press.raw.length - 2], ly = press.raw[press.raw.length - 1];
      if ( Math.hypot(p.x - lx, p.y - ly) > 2 / zoom() ) press.raw.push(p.x, p.y);
    }
  }
  redraw();
}

function onUp(ev) {
  if ( !mode || ev.button !== 0 ) return;
  const p = worldPoint(ev);
  if ( mode === "erase" ) {
    const t = trail; trail = null;
    if ( t ) Zones.eraseAlong(t, eraserR());
    redraw();
    return;
  }
  const pr = press; press = null;
  if ( !pr?.drag ) { redraw(); return; }
  pr.raw.push(p.x, p.y);
  const pts = ev.shiftKey ? [pr.raw[0], pr.raw[1], p.x, p.y] : smoothStroke(pr.raw, g());
  if ( Math.hypot(pts[pts.length - 2] - pts[0], pts[pts.length - 1] - pts[1]) > 2 || pts.length > 4 ) Zones.addStroke(pts);
  redraw();
}

function cancel() { press = null; trail = null; redraw(); }

function onKey(e) {
  if ( !mode || typing(e) || !Zones.editing() ) return;
  const k = e.key;
  if ( (e.ctrlKey || e.metaKey) && (k.toLowerCase() === "z" || k.toLowerCase() === "y") ) {
    e.preventDefault(); e.stopPropagation();
    if ( k.toLowerCase() === "y" || e.shiftKey ) Zones.redoEdit(); else Zones.undoEdit();
    return;
  }
  if ( k === "Escape" && (press || trail) ) { e.preventDefault(); e.stopPropagation(); cancel(); return; }
  if ( k === "Shift" ) { shiftDown = true; redraw(); return; }
  if ( mode === "erase" && !e.ctrlKey && !e.metaKey && (k === "[" || k === "]") ) {
    e.preventDefault(); e.stopPropagation();
    const v = Number(Zones.setting("zonesEraser", 0.5)) || 0.5;
    game.settings.set("moinen-maps", "zonesEraser", Math.round(Math.min(4, Math.max(0.1, v + (k === "]" ? 0.1 : -0.1))) * 100) / 100).then(redraw);
  }
}

/* ---------------------------------------------------------------- lifecycle */

export function onCanvasReady() {
  teardownListeners();
  if ( !game.user.isGM ) return;
  ensureGfx();
  const view = canvas.app.view;
  listeners = {
    down: onDown, move: onMove, up: onUp, key: onKey, cancel,
    keyup: (e) => { if ( e.key === "Shift" ) { shiftDown = false; redraw(); } },
    blur: cancel,
    leave: () => { cursorAt = null; redraw(); },
    pan: () => redraw()
  };
  view.addEventListener("pointerdown", listeners.down, true);
  view.addEventListener("pointermove", listeners.move);
  view.addEventListener("pointerleave", listeners.leave);
  window.addEventListener("pointerup", listeners.up);
  window.addEventListener("pointercancel", listeners.cancel);
  window.addEventListener("blur", listeners.blur);
  window.addEventListener("keydown", listeners.key, true);
  window.addEventListener("keyup", listeners.keyup, true);
  listeners.panHook = Hooks.on("canvasPan", listeners.pan);
  listeners.zHook = Hooks.on("moinenMapsZones", () => redraw());
  redraw();
}

function teardownListeners() {
  if ( !listeners ) return;
  const v = canvas.app?.view;
  v?.removeEventListener("pointerdown", listeners.down, true); v?.removeEventListener("pointermove", listeners.move); v?.removeEventListener("pointerleave", listeners.leave);
  window.removeEventListener("pointerup", listeners.up); window.removeEventListener("pointercancel", listeners.cancel); window.removeEventListener("blur", listeners.blur);
  window.removeEventListener("keydown", listeners.key, true); window.removeEventListener("keyup", listeners.keyup, true);
  Hooks.off("canvasPan", listeners.panHook); Hooks.off("moinenMapsZones", listeners.zHook);
  listeners = null;
}

export function teardown() {
  teardownListeners();
  for ( const o of [gfx, lines] ) if ( o && !o.destroyed ) o.destroy();
  gfx = lines = null; press = trail = cursorAt = null;
}
