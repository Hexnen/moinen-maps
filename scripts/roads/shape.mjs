import * as Graph from "./graph.mjs";
import { KIND_LOOK } from "./art.mjs";
import * as Roads from "./roads.mjs";
import { trackMarkers } from "../workspace/markers.mjs";

/**
 * Editing the shape of a drawn road (the "edit" tool), after the water rods: click a road to select it and its control points
 * show as handles (the curve is a Catmull-Rom spline through them).
 *  - drag a point to bend the road; an end point is a node: every road joined there follows, and an end let go on another
 *    road or junction joins it;
 *  - drag the line to pull out a new point (a click on it adds one); right-click a point or press Delete to remove it;
 *  - double-click a point: smooth point / sharp corner;
 *  - Shift-drag the line: move the whole road; Shift-drag a dead end: grow the road from there;
 *  - Delete with no point picked removes the road; Escape drops the selection.
 * Every change is one undo step. While dragging the roads are baked again live (throttled); the cars take the new roads when
 * the drag ends.
 */

let marks = null;
let sel = null;            // selected edge id
let pick = -1;             // picked control point of the selected edge (for Delete)
let hover = -1;
let drag = null;           // { type, edge, i, from: {x,y}, base: G clone, moved, G }
let previewTimer = 0;

const HANDLE = 7;
const g = () => Roads.gridSize();
const zoom = () => canvas.stage.scale.x;
const snapR = () => Math.max(g() * 0.3, 12 / zoom());
const colorNum = (css) => Number(Color.from(css));

export const selectedEdge = () => sel;
export const selectedRoad = () => (sel != null ? Roads.state()?.G.edges.get(sel) ?? null : null);

export function select(id) {
  if ( id === sel ) return;
  sel = id; pick = -1; hover = -1;
  draw();
  Roads.tell("select");
}

export function reset() { drag = null; clearTimeout(previewTimer); previewTimer = 0; select(null); }

export function attach() {
  if ( marks && !marks.destroyed ) return;
  marks = new PIXI.Graphics(); marks.eventMode = "none"; marks.zIndex = 862;
  canvas.interface.sortableChildren = true; canvas.interface.addChild(marks);
  trackMarkers(marks, { ring: true });     // the GM's marker opacity; handles stay faintly visible so they can still be grabbed
}

export function detach() {
  if ( marks && !marks.destroyed ) marks.destroy();
  marks = null; drag = null; sel = null; pick = hover = -1;
}

/* ---------------------------------------------------------------- hit testing */

const roadOf = (G) => (sel != null ? G.edges.get(sel) : null);

/** The control point of the selected road under (x, y): its index, or -1 (twins of a corner count as one). */
function hitPoint(e, x, y) {
  if ( !e ) return -1;
  const r = (HANDLE + 3) / zoom(), n = e.pts.length >> 1;
  let best = -1, bd = r;
  for ( let i = 0; i < n; i++ ) {
    const d = Math.hypot(e.pts[i * 2] - x, e.pts[i * 2 + 1] - y);
    if ( d <= bd ) { bd = d; best = i; }
  }
  return best;
}

/** Is (x, y) on road e (its width, but never less than a few screen pixels)? */
function onRoad(e, x, y) {
  const c = Graph.edgeCurve(e, g()), h = Graph.nearestOn(c.p, c.ss, x, y);
  return h.d <= Math.max((e.w * g()) / 2, 6 / zoom()) + 4 / zoom() ? h : null;
}

function roadAt(G, x, y) {
  let best = null;
  for ( const e of G.edges.values() ) { const h = onRoad(e, x, y); if ( h && (!best || h.d < best.h.d) ) best = { e, h }; }
  return best;
}

/* ---------------------------------------------------------------- the operations (applied to a copy of the graph) */

/** Apply the drag to graph G with the pointer at (x, y). Returns the ids of the edges to preview. */
function apply(G, d, x, y, final) {
  const e = G.edges.get(d.edge); if ( !e ) return [];
  const n = e.pts.length >> 1;
  if ( d.type === "pt" ) {
    Graph.movePoint(G, d.edge, d.i, x, y);
    const isEnd = d.i === 0 || d.i === n - 1;
    if ( isEnd && final ) Graph.dropNode(G, d.i === 0 ? e.a : e.b, g(), snapR());
    return isEnd ? Graph.incident(G, d.i === 0 ? e.a : e.b).map((x) => x.id) : [d.edge];
  }
  if ( d.type === "new" ) {
    Graph.insertPoint(G, d.edge, d.i, x, y);
    return [d.edge];
  }
  if ( d.type === "move" ) {
    Graph.translateEdge(G, d.edge, x - d.from.x, y - d.from.y);
    return [...new Set([...Graph.incident(G, e.a), ...Graph.incident(G, e.b)].map((x) => x.id))];
  }
  if ( d.type === "extend" ) {
    Graph.extendEnd(G, d.edge, d.i === 0, x, y);
    if ( final ) Graph.dropNode(G, d.i === 0 ? e.a : e.b, g(), snapR());
    return [d.edge];
  }
  return [];
}

function preview(G) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => { previewTimer = 0; Roads.previewGraph(G); }, 60);
}

/* ---------------------------------------------------------------- pointer */

/** Pointer down (left button) with the edit tool. Returns true when it took the event. */
export function down(ev, p) {
  const R = Roads.state(); if ( !R ) return false;
  const e = roadOf(R.G);
  const i = hitPoint(e, p.x, p.y);
  if ( e && i >= 0 ) {
    const n = e.pts.length >> 1, end = i === 0 || i === n - 1;
    pick = i;
    const type = ev.shiftKey && end && Graph.degree(R.G, i === 0 ? e.a : e.b) === 1 ? "extend" : "pt";
    drag = { type, edge: e.id, i, from: p, sx: ev.clientX, sy: ev.clientY, base: Graph.cloneGraph(R.G), moved: false };
    draw();
    return true;
  }
  const h = e ? onRoad(e, p.x, p.y) : null;
  if ( e && h ) {
    drag = ev.shiftKey
      ? { type: "move", edge: e.id, from: p, sx: ev.clientX, sy: ev.clientY, base: Graph.cloneGraph(R.G), moved: false }
      : { type: "new", edge: e.id, i: Graph.spanAt(e, g(), h.s), from: p, sx: ev.clientX, sy: ev.clientY, base: Graph.cloneGraph(R.G), moved: false };
    return true;
  }
  const hit = roadAt(R.G, p.x, p.y);
  select(hit ? hit.e.id : null);
  if ( hit && ev.shiftKey ) drag = { type: "move", edge: hit.e.id, from: p, sx: ev.clientX, sy: ev.clientY, base: Graph.cloneGraph(R.G), moved: false };
  return true;
}

export function move(ev, p) {
  if ( drag ) {
    if ( !drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 3 ) return;
    drag.moved = true;
    const G = Graph.cloneGraph(drag.base);
    drag.ids = apply(G, drag, p.x, p.y, false);
    drag.G = G;
    preview(G);
    draw();
    return;
  }
  const R = Roads.state(), e = R ? roadOf(R.G) : null;
  const i = hitPoint(e, p.x, p.y);
  if ( i !== hover ) { hover = i; draw(); }
}

export function up(ev, p) {
  const d = drag; drag = null;
  clearTimeout(previewTimer); previewTimer = 0;
  if ( !d ) return;
  // a click on the line of the selected road adds a point there
  if ( !d.moved && d.type !== "new" ) { draw(); return; }
  const keep = d.type === "pt" || d.type === "extend" ? { x: p.x, y: p.y } : d.from;
  const changed = Roads.edit((G) => { apply(G, d, p.x, p.y, true); return true; });
  if ( !changed ) Roads.previewGraph(null);
  // the edge may have been joined or split: keep the selection on the road under the moved point
  const R = Roads.state();
  if ( R && !R.G.edges.has(sel) ) { const hit = roadAt(R.G, keep.x, keep.y); sel = hit?.e.id ?? null; Roads.tell("select"); }
  if ( d.type === "new" ) pick = d.i;
  draw();
}

export function cancel() {
  if ( !drag ) return false;
  drag = null; clearTimeout(previewTimer); previewTimer = 0;
  Roads.previewGraph(null);
  draw();
  return true;
}

/** Right-click: a point of the selected road goes. */
export function right(p) {
  const R = Roads.state(), e = R ? roadOf(R.G) : null;
  const i = hitPoint(e, p.x, p.y);
  if ( i < 0 ) return false;
  Roads.edit((G) => Graph.removePoint(G, e.id, i));
  pick = -1; draw();
  return true;
}

export function dblclick(p) {
  const R = Roads.state(), e = R ? roadOf(R.G) : null;
  const i = hitPoint(e, p.x, p.y);
  if ( i < 0 ) return false;
  Roads.edit((G) => Graph.toggleCorner(G, e.id, i));
  draw();
  return true;
}

export function key(ev) {
  const R = Roads.state(), e = R ? roadOf(R.G) : null;
  if ( ev.key === "Escape" ) { if ( cancel() ) return true; if ( sel != null ) { select(null); return true; } return false; }
  if ( (ev.key === "Delete" || ev.key === "Backspace") && e ) {
    if ( pick > 0 && pick < (e.pts.length >> 1) - 1 ) { Roads.edit((G) => Graph.removePoint(G, e.id, pick)); pick = -1; }
    else { const id = e.id; select(null); Roads.edit((G) => Graph.removeEdge(G, id, g())); }
    draw();
    return true;
  }
  return false;
}

/* ---------------------------------------------------------------- drawing */

export function draw() {
  if ( !marks || marks.destroyed ) return;
  marks.clear();
  const R = Roads.state(); if ( !R ) return;
  const G = drag?.G ?? R.G, e = roadOf(G);
  if ( !e ) return;
  const z = zoom(), c = Graph.edgeCurve(e, g()), W = e.w * g();
  // the dragged roads as they will be
  if ( drag?.G ) {
    for ( const id of drag.ids ?? [] ) {
      const x = G.edges.get(id); if ( !x ) continue;
      const p = Graph.edgeCurve(x, g()).p;
      marks.lineStyle({ width: Math.max(x.w * g(), 3 / z), color: colorNum(KIND_LOOK[x.k]?.surface ?? "#888888"), alpha: 0.35, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
      trace(marks, p);
    }
  }
  // the selected road: an outline along both edges
  marks.lineStyle({ width: Math.max(W, 4 / z) + 6 / z, color: 0xFFE08A, alpha: 0.35, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND }); trace(marks, c.p);
  marks.lineStyle({ width: 1.5 / z, color: 0x15110F, alpha: 0.9 }); trace(marks, c.p);
  // the control polygon
  marks.lineStyle({ width: 1 / z, color: 0xFFFFFF, alpha: 0.55 }); trace(marks, e.pts);
  const n = e.pts.length >> 1, r = HANDLE / z;
  for ( let i = 0; i < n; i++ ) {
    const x = e.pts[i * 2], y = e.pts[i * 2 + 1];
    if ( i > 0 && x === e.pts[i * 2 - 2] && y === e.pts[i * 2 - 1] ) continue;          // the twin of a corner
    const end = i === 0 || i === n - 1, corner = Graph.twins(e, i).length > 1;
    const hot = i === hover || i === pick;
    marks.lineStyle({ width: 1.5 / z, color: 0x15110F, alpha: 1 });
    marks.beginFill(hot ? 0xFFE08A : end ? 0xFFA63D : 0xFFFFFF, 1);
    if ( end ) marks.drawRect(x - r, y - r, r * 2, r * 2);
    else if ( corner ) marks.drawPolygon([x, y - r * 1.3, x + r * 1.3, y, x, y + r * 1.3, x - r * 1.3, y]);
    else marks.drawCircle(x, y, r * (hot ? 1.2 : 1));
    marks.endFill();
  }
}

function trace(G, p) { G.moveTo(p[0], p[1]); for ( let i = 2; i < p.length; i += 2 ) G.lineTo(p[i], p[i + 1]); }
