import { MODULE_ID } from "../config.mjs";
import * as Graph from "./graph.mjs";
import { KIND_LOOK } from "./art.mjs";
import * as Roads from "./roads.mjs";
import * as Shape from "./shape.mjs";
import { trackMarkers } from "../workspace/markers.mjs";

/**
 * Painting roads (GM). Two tools:
 *  - draw: drag to paint a road freehand, or click point after point and finish with a double-click, Enter, a click on the last
 *    point or a right-click. Ends snap to a nearby road or junction; crossings become junctions. Alt-click a road to give it the
 *    current brush (kind, width, lanes, one-way); Alt+Shift-click turns a one-way road around; right-click a road to delete it.
 *  - erase: drag a brush over roads to cut them.
 * Keys: [ and ] the width (or the eraser size), Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y) undo / redo, Backspace drops the last clicked
 * point, Escape cancels.
 * Real pointer events on the canvas view, caught in the capture phase so the active layer does not also act on them.
 */

let mode = null;
let gfx = null, overlay = null, listeners = null;
let press = null;          // { x, y, sx, sy, raw: [...], drag }
let poly = null;           // clicked points [x, y, ...] of a road being drawn point by point
let polyStraight = [];     // per span of `poly`: clicked with Shift (a straight span)
let guides = null;         // the GM's view of the guide lines (never shown to players)
let shiftDown = false;
let lastPainted = "asphalt";
let eraseTrail = null;     // flat world points while erasing
let cursorAt = null;
let lastClick = { t: 0, x: 0, y: 0 };

const g = () => Roads.gridSize();
const zoom = () => canvas.stage.scale.x;
const worldPoint = (ev) => canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY });
const snapR = () => Math.max(g() * 0.35, (Roads.brush().w * g()) * 0.5, 10 / zoom());
const colorNum = (css) => { const c = Color.from(css); return Number(c); };
const typing = (ev) => { const t = ev.target; return t instanceof HTMLElement && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName)); };

export const mode_ = () => mode;
export const selectedEdge = () => Shape.selectedEdge();
export { mode_ as mode };

/** Switch the tool: "draw", "erase", "edit" (the shape of drawn roads) or null (off). */
export function setMode(m) {
  m = m === "draw" || m === "erase" || m === "edit" ? m : null;
  if ( m && !game.user.isGM ) return;
  if ( m === mode ) return;
  mode = m;
  press = null; poly = null; polyStraight = []; eraseTrail = null;
  if ( m === "edit" && canvas.ready ) Shape.attach(); else Shape.reset();
  document.body.classList.toggle("mm-painting-roads", !!mode);
  if ( mode && canvas.ready ) ensureGfx();
  redraw();
  Roads.tell("mode");
}

function ensureGfx() {
  if ( gfx && !gfx.destroyed ) return;
  canvas.interface.sortableChildren = true;
  overlay = new PIXI.Graphics(); overlay.eventMode = "none"; overlay.zIndex = 855;
  gfx = new PIXI.Graphics(); gfx.eventMode = "none"; gfx.zIndex = 860;
  canvas.interface.addChild(overlay); canvas.interface.addChild(gfx);
  // the GM's marker opacity (workspace bar): the junction markers fade fully, the pen and the stroke being drawn stay faintly visible
  trackMarkers(overlay); trackMarkers(gfx, { ring: true });
}

/* ---------------------------------------------------------------- drawing the editor's marks */

function trace(G, p) { G.moveTo(p[0], p[1]); for ( let i = 2; i < p.length; i += 2 ) G.lineTo(p[i], p[i + 1]); }

/** A polyline offset sideways by `off` (the edges of a guide's corridor). */
function offset(p, off) {
  const n = p.length >> 1, out = new Array(n * 2);
  for ( let i = 0; i < n; i++ ) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
    let dx = p[i1 * 2] - p[i0 * 2], dy = p[i1 * 2 + 1] - p[i0 * 2 + 1];
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    out[i * 2] = p[i * 2] - dy * off; out[i * 2 + 1] = p[i * 2 + 1] + dx * off;
  }
  return out;
}

function dashed(G, p, dash, gap) {
  let on = true, left = dash;
  G.moveTo(p[0], p[1]);
  for ( let i = 2; i < p.length; i += 2 ) {
    let ax = p[i - 2], ay = p[i - 1];
    const bx = p[i], by = p[i + 1];
    let seg = Math.hypot(bx - ax, by - ay);
    while ( seg > 1e-9 ) {
      const t = Math.min(seg, left), f = t / seg;
      const x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
      if ( on ) G.lineTo(x, y); else G.moveTo(x, y);
      ax = x; ay = y; seg -= t; left -= t;
      if ( left <= 1e-6 ) { on = !on; left = on ? dash : gap; }
    }
  }
}

/**
 * Guide lines (roads traced over the map's own drawing): a faint corridor as wide as the road with a dashed centre line and
 * one-way arrows. GM only: while a road tool is in hand, or always when the scene says so. Players never see them.
 */
function drawGuides() {
  if ( !guides || guides.destroyed ) return;
  guides.clear();
  const R = Roads.state();
  if ( !R || !game.user.isGM || !(mode || R.look.guides === "always") ) return;
  const z = zoom(), gs = g();
  for ( const e of R.G.edges.values() ) {
    if ( e.k !== "guide" ) continue;
    const p = Graph.edgeCurve(e, gs).p, W = e.w * gs;
    guides.lineStyle({ width: W, color: 0x46D0D0, alpha: mode ? 0.16 : 0.1, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND }); trace(guides, p);
    for ( const s of [-0.5, 0.5] ) { guides.lineStyle({ width: 1.2 / z, color: 0x46D0D0, alpha: 0.7 }); trace(guides, offset(p, W * s)); }
    guides.lineStyle({ width: 3 / z, color: 0x15110F, alpha: 0.5 }); dashed(guides, p, 10 / z, 7 / z);
    guides.lineStyle({ width: 1.5 / z, color: 0xE8F4FF, alpha: 0.95 }); dashed(guides, p, 10 / z, 7 / z);
    if ( e.o ) {
      const ss = Graph.lengths(p), L = ss[ss.length - 1], a = Math.min(W * 0.3, 14 / z);
      for ( let s = gs; s < L - gs * 0.5; s += gs * 2 ) {
        const [x, y] = Graph.pointAtS(p, ss, s), [x2, y2] = Graph.pointAtS(p, ss, s + 1);
        const dx = x2 - x, dy = y2 - y, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
        guides.lineStyle({ width: 2 / z, color: 0xE8F4FF, alpha: 0.95 });
        guides.moveTo(x - ux * a - uy * a, y - uy * a + ux * a); guides.lineTo(x, y); guides.lineTo(x - ux * a + uy * a, y - uy * a - ux * a);
      }
    }
  }
}

/** The control points of the road being clicked (with the cursor as the next point): straight spans get extra points. */
function polyPoints(withCursor) {
  if ( !poly ) return null;
  const pts = poly.slice(), flags = polyStraight.slice();
  if ( withCursor && cursorAt ) {
    const q = shiftDown ? Graph.snapAngle(pts[pts.length - 2], pts[pts.length - 1], cursorAt.x, cursorAt.y) : cursorAt;
    pts.push(q.x, q.y); flags.push(shiftDown);
  }
  const out = [pts[0], pts[1]];
  for ( let i = 2; i < pts.length; i += 2 ) {
    if ( flags[(i >> 1) - 1] ) out.push(...Graph.straighten([pts[i - 2], pts[i - 1], pts[i], pts[i + 1]], g()).slice(2));
    else out.push(pts[i], pts[i + 1]);
  }
  return out;
}

/** A freehand stroke: smoothed (a guide harder), or with Shift a straight line at a multiple of 15 degrees. */
function strokePoints(raw, straight) {
  if ( straight ) {
    const e = Graph.snapAngle(raw[0], raw[1], raw[raw.length - 2], raw[raw.length - 1]);
    return Graph.straighten([raw[0], raw[1], e.x, e.y], g());
  }
  return Graph.smoothStroke(raw, g(), Roads.brush().k === "guide");
}

/** Nodes of the network while a tool is on: junctions white, dead ends amber, map-edge exits teal. */
function drawOverlay() {
  if ( !overlay ) return;
  overlay.clear();
  const R = Roads.state(); if ( !mode || !R ) return;
  const z = zoom(), rect = canvas.dimensions.sceneRect, m = g() * 0.6;
  for ( const n of R.G.nodes.values() ) {
    const d = Graph.degree(R.G, n.id);
    const edge = d === 1 && (n.x <= rect.x + m || n.y <= rect.y + m || n.x >= rect.x + rect.width - m || n.y >= rect.y + rect.height - m);
    const col = d >= 3 ? 0xFFFFFF : edge ? 0x46D0D0 : d === 1 ? 0xFFA63D : 0xBBBBBB;
    overlay.lineStyle({ width: 1.5 / z, color: 0x15110F, alpha: 1 });
    overlay.beginFill(col, 0.95).drawCircle(n.x, n.y, (d >= 3 ? 5 : 4) / z).endFill();
  }
}

function redraw() {
  drawOverlay(); drawGuides();
  if ( mode === "edit" ) Shape.draw();
  if ( !gfx ) return;
  gfx.clear();
  if ( !mode || !cursorAt || mode === "edit" ) return;
  const z = zoom(), b = Roads.brush(), W = b.w * g();
  const L = KIND_LOOK[b.k];
  if ( mode === "erase" ) {
    const r = b.eraser * g() / 2;
    if ( eraseTrail?.length >= 2 ) {
      gfx.lineStyle({ width: r * 2, color: 0xE5322D, alpha: 0.28, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
      trace(gfx, eraseTrail.length === 2 ? [eraseTrail[0], eraseTrail[1], eraseTrail[0] + 0.01, eraseTrail[1]] : eraseTrail);
    }
    gfx.lineStyle({ width: 2 / z, color: 0xFFFFFF, alpha: 0.95 }).drawCircle(cursorAt.x, cursorAt.y, r);
    gfx.lineStyle({ width: 1 / z, color: 0x15110F, alpha: 0.6 }).drawCircle(cursorAt.x, cursorAt.y, r + 2 / z);
    return;
  }
  // the road being drawn: a translucent band of the brush's kind with an ink edge
  let line = null;
  if ( press?.drag && press.raw.length >= 4 ) line = shiftDown ? Graph.curve(strokePoints(press.raw, true), g() * 0.1) : press.raw;
  else if ( poly ) line = Graph.curve(polyPoints(true), g() * 0.1);
  if ( line && b.k === "guide" ) {
    // a guide shows where the cars will run without hiding the map's own road
    gfx.lineStyle({ width: W, color: 0x46D0D0, alpha: 0.22, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND }); trace(gfx, line);
    gfx.lineStyle({ width: 2 / z, color: 0xE8F4FF, alpha: 0.95 }); trace(gfx, line);
  } else if ( line ) {
    gfx.lineStyle({ width: W + 4 / z, color: 0x15110F, alpha: 0.55, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND }); trace(gfx, line);
    gfx.lineStyle({ width: W, color: colorNum(L.surface), alpha: 0.7, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND }); trace(gfx, line);
  }
  if ( poly ) {
    gfx.lineStyle({ width: 1.5 / z, color: 0x15110F, alpha: 1 });
    for ( let i = 0; i < poly.length; i += 2 ) gfx.beginFill(0xFFE08A, 1).drawCircle(poly[i], poly[i + 1], 4 / z).endFill();
  }
  // where the pen would attach
  const R = Roads.state();
  const t = R ? Graph.snapTarget(R.G, cursorAt.x, cursorAt.y, snapR(), g()) : null;
  if ( t ) {
    gfx.lineStyle({ width: 2.5 / z, color: t.kind === "node" ? 0xFFFFFF : 0xFFE08A, alpha: 1 }).drawCircle(t.x, t.y, 7 / z);
    gfx.lineStyle({ width: 1 / z, color: 0x15110F, alpha: 0.8 }).drawCircle(t.x, t.y, 9 / z);
  } else {
    gfx.lineStyle({ width: 1.5 / z, color: colorNum(L.surface === "#4a4c52" ? "#e8e2d0" : L.surface), alpha: 0.95 }).drawCircle(cursorAt.x, cursorAt.y, W / 2);
    gfx.lineStyle({ width: 1 / z, color: 0x15110F, alpha: 0.6 }).drawCircle(cursorAt.x, cursorAt.y, W / 2 + 2 / z);
  }
}

/* ---------------------------------------------------------------- committing */

function addRoad(ctrl) {
  const b = Roads.brush();
  if ( ctrl.length < 4 ) return;
  Roads.edit((G) => Graph.addStroke(G, ctrl, { k: b.k, w: b.w, l: b.l, o: b.o }, g(), snapR()).length > 0);
}

function finishPoly() {
  const p = poly ? polyPoints(false) : null; poly = null; polyStraight = [];
  if ( p && p.length >= 4 ) addRoad(p);
  redraw();
}

function edgeAt(pt) {
  const R = Roads.state(); if ( !R ) return null;
  return Graph.nearestEdge(R.G, pt.x, pt.y, Math.max(g() * 0.3, 8 / zoom()), g(), (e) => Graph.nearestOn(Graph.edgeCurve(e, g()).p, Graph.edgeCurve(e, g()).ss, pt.x, pt.y).d <= (e.w * g()) / 2 + 6 / zoom());
}

/* ---------------------------------------------------------------- pointer handling */

function onDown(ev) {
  if ( !mode || !game.user.isGM ) return;
  if ( ev.button === 2 ) { press = { x: 0, y: 0, sx: ev.clientX, sy: ev.clientY, right: true }; return; }   // right-drag still pans
  if ( ev.button !== 0 ) return;
  ev.stopImmediatePropagation(); ev.preventDefault();
  const p = worldPoint(ev);
  cursorAt = p;
  if ( mode === "edit" ) { Shape.down(ev, p); return; }
  if ( mode === "erase" ) { eraseTrail = [p.x, p.y]; redraw(); return; }
  if ( ev.altKey ) {
    const hit = edgeAt(p);
    if ( hit ) {
      const b = Roads.brush();
      if ( ev.shiftKey ) Roads.edit((G) => Graph.reverseEdge(G, hit.e.id));
      else Roads.edit((G) => Graph.restyle(G, hit.e.id, b, g()));
    }
    return;
  }
  press = { x: p.x, y: p.y, sx: ev.clientX, sy: ev.clientY, raw: [p.x, p.y], drag: false };
}

function onMove(ev) {
  if ( !mode ) return;
  const p = worldPoint(ev);
  cursorAt = p; shiftDown = ev.shiftKey;
  if ( mode === "edit" ) { Shape.move(ev, p); return; }
  if ( mode === "erase" && eraseTrail ) {
    const lx = eraseTrail[eraseTrail.length - 2], ly = eraseTrail[eraseTrail.length - 1];
    if ( Math.hypot(p.x - lx, p.y - ly) > 2 / zoom() ) eraseTrail.push(p.x, p.y);
  } else if ( press && !press.right ) {
    if ( !press.drag && Math.hypot(ev.clientX - press.sx, ev.clientY - press.sy) > 6 && !poly ) press.drag = true;
    if ( press.drag ) {
      const lx = press.raw[press.raw.length - 2], ly = press.raw[press.raw.length - 1];
      if ( Math.hypot(p.x - lx, p.y - ly) > 3 / zoom() ) press.raw.push(p.x, p.y);
    }
  }
  redraw();
}

function onUp(ev) {
  if ( !mode ) return;
  const p = worldPoint(ev);
  if ( ev.button === 2 ) {
    const pr = press; press = null;
    if ( !pr?.right || Math.hypot(ev.clientX - pr.sx, ev.clientY - pr.sy) > 5 ) return;
    if ( mode === "edit" ) { Shape.right(p); return; }
    if ( mode !== "draw" ) return;
    if ( poly ) { finishPoly(); return; }
    const hit = edgeAt(p);
    if ( hit ) Roads.edit((G) => Graph.removeEdge(G, hit.e.id, g()));
    return;
  }
  if ( ev.button !== 0 ) return;
  if ( mode === "edit" ) { Shape.up(ev, p); return; }
  if ( mode === "erase" ) {
    const trail = eraseTrail; eraseTrail = null;
    if ( trail ) Roads.edit((G) => Graph.erase(G, trail, Roads.brush().eraser * g() / 2, g()));
    redraw();
    return;
  }
  const pr = press; press = null;
  if ( !pr ) return;
  if ( pr.drag ) {
    pr.raw.push(p.x, p.y);
    addRoad(strokePoints(pr.raw, ev.shiftKey));
    redraw();
    return;
  }
  // a click: one more point of a road drawn point by point
  // a double click: two quick clicks on the same spot (quick clicks on different spots are just fast drawing)
  const t = performance.now(), dbl = t - lastClick.t < 350 && Math.hypot(ev.clientX - lastClick.x, ev.clientY - lastClick.y) < 8;
  lastClick = { t, x: ev.clientX, y: ev.clientY };
  let q = { x: p.x, y: p.y };
  if ( !poly ) {
    const R = Roads.state(), s = R ? Graph.snapTarget(R.G, q.x, q.y, snapR(), g()) : null;
    if ( s ) q = { x: s.x, y: s.y };
    poly = [q.x, q.y]; polyStraight = [];
  } else {
    const lx = poly[poly.length - 2], ly = poly[poly.length - 1];
    const onLast = Math.hypot(q.x - lx, q.y - ly) < 10 / zoom();
    if ( dbl || onLast ) { finishPoly(); return; }
    // Shift: a straight span at a multiple of 15 degrees (roads drawn on a grid)
    if ( ev.shiftKey ) q = Graph.snapAngle(lx, ly, q.x, q.y);
    poly.push(q.x, q.y); polyStraight.push(ev.shiftKey);
  }
  redraw();
}

/** Drop whatever gesture is under way (also a shape drag of the edit tool: the real roads come back on screen). */
function cancel() { press = null; poly = null; polyStraight = []; eraseTrail = null; Shape.cancel(); redraw(); }

/** G: switch the brush between a guide line and the last painted kind. */
function toggleGuide() {
  const k = Roads.brush().k;
  if ( k !== "guide" ) lastPainted = k;
  Roads.setBrush({ k: k === "guide" ? lastPainted : "guide" });
}

/** One step of the [ ] keys: 0.1 square, finer (0.05) below 0.3; from 0.05 to 3 squares. */
export function stepWidth(w, dir) {
  const d = (dir > 0 ? w >= 0.3 : w > 0.3) ? 0.1 : 0.05;
  return Math.round(Math.min(3, Math.max(0.05, w + d * dir)) * 100) / 100;
}

function onKey(e) {
  if ( !mode || typing(e) ) return;
  const k = e.key;
  if ( (e.ctrlKey || e.metaKey) && (k.toLowerCase() === "z" || k.toLowerCase() === "y") ) {
    e.preventDefault(); e.stopPropagation();
    if ( k.toLowerCase() === "y" || e.shiftKey ) Roads.redoEdit(); else Roads.undoEdit();
    return;
  }
  if ( mode === "edit" ) {
    if ( Shape.key(e) ) { e.preventDefault(); e.stopPropagation(); return; }
    const road = Shape.selectedRoad();
    if ( road && !e.ctrlKey && !e.metaKey && (k === "[" || k === "]") ) {
      e.preventDefault(); e.stopPropagation();
      const w = stepWidth(road.w, k === "]" ? 1 : -1), id = road.id;
      Roads.edit((G) => { const x = G.edges.get(id); if ( !x || x.w === w ) return false; x.w = w; return true; });
    }
    return;
  }
  if ( k === "Escape" && (poly || press || eraseTrail) ) { e.preventDefault(); e.stopPropagation(); cancel(); return; }
  if ( k === "Enter" && poly ) { e.preventDefault(); e.stopPropagation(); finishPoly(); return; }
  if ( k === "Backspace" && poly ) { e.preventDefault(); e.stopPropagation(); poly.splice(-2, 2); polyStraight.pop(); if ( !poly.length ) poly = null; redraw(); return; }
  if ( k === "Shift" ) { shiftDown = true; redraw(); return; }
  if ( mode === "draw" && !e.ctrlKey && !e.metaKey && !e.altKey && k.toLowerCase() === "g" ) { e.preventDefault(); e.stopPropagation(); toggleGuide(); return; }
  if ( !e.ctrlKey && !e.metaKey && (k === "[" || k === "]") ) {
    e.preventDefault(); e.stopPropagation();
    const b = Roads.brush(), d = k === "]" ? 0.1 : -0.1;
    if ( mode === "erase" ) Roads.setBrush({ eraser: Math.round(Math.min(4, Math.max(0.15, b.eraser + d * 2)) * 100) / 100 });
    else Roads.setBrush({ w: stepWidth(b.w, k === "]" ? 1 : -1) });
  }
}

/* ---------------------------------------------------------------- lifecycle */

export function onCanvasReady() {
  teardownListeners();
  if ( !game.user.isGM ) return;
  if ( mode ) ensureGfx();
  if ( mode === "edit" ) Shape.attach();
  // guide lines live under the editor marks; only the GM's client ever draws them
  guides = new PIXI.Graphics(); guides.eventMode = "none"; guides.zIndex = 850;
  canvas.interface.sortableChildren = true; canvas.interface.addChild(guides); trackMarkers(guides);
  const view = canvas.app.view;
  listeners = {
    down: onDown, move: onMove, up: onUp, key: onKey, cancel,
    // a road being clicked point by point survives losing focus; a drag (pen, eraser, shape) does not
    blur: () => { press = null; eraseTrail = null; Shape.cancel(); redraw(); },
    menu: (e) => { if ( mode ) e.preventDefault(); },
    leave: () => { cursorAt = null; redraw(); },
    dbl: (e) => {
      if ( mode === "draw" && poly ) { e.preventDefault(); e.stopPropagation(); finishPoly(); }
      else if ( mode === "edit" && Shape.dblclick(worldPoint(e)) ) { e.preventDefault(); e.stopPropagation(); }
    }
  };
  view.addEventListener("pointerdown", listeners.down, true);
  view.addEventListener("pointermove", listeners.move);
  view.addEventListener("pointerleave", listeners.leave);
  view.addEventListener("contextmenu", listeners.menu, true);
  view.addEventListener("dblclick", listeners.dbl, true);
  window.addEventListener("pointerup", listeners.up);
  window.addEventListener("pointercancel", listeners.cancel);
  window.addEventListener("blur", listeners.blur);          // the window lost focus mid-drag: the pointerup may never come
  window.addEventListener("keydown", listeners.key, true);
  Hooks.on("moinenMapsRoads", onRoadsEvent);
  redraw();
}

function onRoadsEvent(kind) {
  if ( mode === "edit" && (kind === "edited" || kind === "loaded") && Shape.selectedEdge() != null && !Roads.state()?.G.edges.has(Shape.selectedEdge()) ) Shape.select(null);
  if ( ["edited", "loaded", "brush", "params"].includes(kind) ) redraw();
}
export function onPan() { if ( mode || Roads.state()?.look.guides === "always" ) redraw(); }

function teardownListeners() {
  if ( !listeners ) return;
  const v = canvas.app?.view;
  v?.removeEventListener("pointerdown", listeners.down, true); v?.removeEventListener("pointermove", listeners.move);
  v?.removeEventListener("pointerleave", listeners.leave); v?.removeEventListener("contextmenu", listeners.menu, true);
  v?.removeEventListener("dblclick", listeners.dbl, true);
  window.removeEventListener("pointerup", listeners.up); window.removeEventListener("pointercancel", listeners.cancel); window.removeEventListener("blur", listeners.blur);
  window.removeEventListener("keydown", listeners.key, true);
  Hooks.off("moinenMapsRoads", onRoadsEvent);
  listeners = null;
}

export function teardown() {
  teardownListeners();
  Shape.detach();
  for ( const o of [gfx, overlay, guides] ) if ( o && !o.destroyed ) o.destroy();
  gfx = overlay = guides = null; press = poly = eraseTrail = cursorAt = null; polyStraight = [];
}

export const _debug = () => ({ mode, poly, press, module: MODULE_ID });
