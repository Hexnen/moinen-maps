import { MODULE_ID } from "../config.mjs";
import * as Model from "./model.mjs";
import * as Water from "./water.mjs";
import { activeToolName } from "../tools.mjs";

/**
 * Guide rods: bendable lines drawn on the map that steer the water (flow rods) or mark the edge a fall goes over (lip rods).
 * A rod is { pts: [x1, y1, x2, y2, ...], parent?: n, at?: f, kind?: "lip" } in art pixels of the scene's water grid (pixel centres
 * at + 0.5), exactly the engine's own format (lib/wowe/guide.lua): `parent` is the 1-based index of the rod a branch grows from and
 * `at` where on it (0..1 of its length). The geometry below is a port of the engine's, so the editor and the engine agree on the curve.
 *
 * Interaction (rod tool): drag on the water for a new rod; drag a dot to bend; drag the line for a new dot; Shift-drag an end dot to
 * grow the rod; Alt-drag the line (or switch Branch on) for a branch; right-click a dot to remove it, the line to remove the rod.
 */

export const RODS_TOOL = "mm-w-rods";
const REACH_PX = 9, DOT_PX = 9;
const UNDO_MAX = 20;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const opt = (k) => game.settings.get(MODULE_ID, k);

export function registerRodSettings() {
  game.settings.register(MODULE_ID, "waterRodKind", { scope: "client", config: false, type: String, default: "flow", onChange: () => Hooks.callAll("moinenMapsRods") });
  game.settings.register(MODULE_ID, "waterRodBranch", { scope: "client", config: false, type: Boolean, default: false, onChange: () => Hooks.callAll("moinenMapsRods") });
}

/* ---------------------------------------------------------------- geometry (port of guide.lua) */

const catmull = (a, b, c, d, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
};

/** The rod's curve, a point about every `step` px: xs, ys, and the span of control points each lies on (1-based). */
export function sample(pts, step = 1.5) {
  const n = pts.length >> 1, xs = [], ys = [], span = [];
  if ( n < 2 ) return { xs, ys, span };
  const P = (i) => { i = Math.max(1, Math.min(n, i)); return [pts[i * 2 - 2], pts[i * 2 - 1]]; };
  for ( let i = 1; i <= n - 1; i++ ) {
    const [ax, ay] = P(i - 1), [bx, by] = P(i), [cx, cy] = P(i + 1), [dx, dy] = P(i + 2);
    const k = Math.max(1, Math.ceil(Math.hypot(cx - bx, cy - by) / step));
    for ( let q = 0; q < k; q++ ) {
      const t = q / k;
      xs.push(catmull(ax, bx, cx, dx, t)); ys.push(catmull(ay, by, cy, dy, t)); span.push(i);
    }
  }
  const [lx, ly] = P(n);
  xs.push(lx); ys.push(ly); span.push(n - 1);
  return { xs, ys, span };
}

export function chain(r) {
  const { xs, ys, span } = sample(r.pts, 1.5), n = xs.length, ss = [];
  let s = 0;
  for ( let k = 0; k < n; k++ ) { if ( k ) s += Math.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]); ss.push(s); }
  return { xs, ys, span, ss, len: s };
}

export function pointAt(c, at) {
  const n = c.xs.length;
  if ( !n ) return null;
  if ( n === 1 || c.len <= 0 ) return [c.xs[0], c.ys[0]];
  const want = clamp(at, 0, 1) * c.len;
  for ( let k = 1; k < n; k++ ) {
    if ( c.ss[k] >= want ) {
      const seg = c.ss[k] - c.ss[k - 1], f = seg > 0 ? (want - c.ss[k - 1]) / seg : 0;
      return [c.xs[k - 1] + (c.xs[k] - c.xs[k - 1]) * f, c.ys[k - 1] + (c.ys[k] - c.ys[k - 1]) * f];
    }
  }
  return [c.xs[n - 1], c.ys[n - 1]];
}

/** Nearest point of a chain to (x, y): { d, at (0..1), x, y, span }. */
export function nearest(c, x, y) {
  let best = { d: Infinity, at: 0, x: 0, y: 0, span: 1 };
  for ( let k = 0; k < c.xs.length - 1; k++ ) {
    const ax = c.xs[k], ay = c.ys[k], vx = c.xs[k + 1] - ax, vy = c.ys[k + 1] - ay, L2 = vx * vx + vy * vy;
    const t = L2 > 0 ? clamp(((x - ax) * vx + (y - ay) * vy) / L2, 0, 1) : 0;
    const px = ax + vx * t, py = ay + vy * t, d = Math.hypot(x - px, y - py);
    if ( d < best.d ) { const s = c.ss[k] + (c.ss[k + 1] - c.ss[k]) * t; best = { d, at: c.len > 0 ? s / c.len : 0, x: px, y: py, span: c.span[k] }; }
  }
  return best;
}

/** Branch first points back on their parents (after a parent moved). */
export function attach(rods) {
  for ( let pass = 0; pass < 4; pass++ ) {
    let moved = false;
    for ( const r of rods ) {
      const par = r.parent ? rods[r.parent - 1] : null;
      if ( par && par !== r && r.pts.length >= 4 ) {
        const p = pointAt(chain(par), r.at ?? 0);
        if ( p && (p[0] !== r.pts[0] || p[1] !== r.pts[1]) ) { r.pts[0] = p[0]; r.pts[1] = p[1]; moved = true; }
      }
    }
    if ( !moved ) break;
  }
}

/** Rod i (0-based) and every branch growing from it gone. */
export function removeRod(rods, i) {
  const gone = new Set([i + 1]);
  let again = true;
  while ( again ) {
    again = false;
    rods.forEach((r, k) => { if ( !gone.has(k + 1) && r.parent && gone.has(r.parent) ) { gone.add(k + 1); again = true; } });
  }
  const map = {}, out = [];
  rods.forEach((r, k) => { if ( !gone.has(k + 1) ) { out.push(r); map[k + 1] = out.length; } });
  for ( const r of out ) if ( r.parent ) r.parent = map[r.parent];
  return out;
}

/** Rod i the other way round; its branches stay where they are on it, a reversed branch comes off its parent. */
export function reverseRod(rods, i) {
  const r = rods[i]; if ( !r ) return;
  const pts = [];
  for ( let k = (r.pts.length >> 1); k >= 1; k-- ) pts.push(r.pts[k * 2 - 2], r.pts[k * 2 - 1]);
  r.pts = pts; delete r.parent; delete r.at;
  for ( const b of rods ) if ( b.parent === i + 1 ) b.at = 1 - (b.at ?? 0);
  attach(rods);
}

const clone = (rods) => foundry.utils.deepClone(rods ?? []);

/* ---------------------------------------------------------------- editing state */

let gfx = null, listeners = null, drag = null, hover = null;
let selected = -1;
const undo = [];

const S = () => Water.state();
const rods = () => Array.isArray(S()?.params?.guides) ? S().params.guides : [];
const active = () => game.user.isGM && activeToolName() === RODS_TOOL;
const zoom = () => canvas.stage.scale.x;
const toArt = (p) => { const r = Model.sceneRect(), s = S(); return [(p.x - r.x) / s.px, (p.y - r.y) / s.px]; };
const toWorld = (x, y) => { const r = Model.sceneRect(), s = S(); return [r.x + x * s.px, r.y + y * s.px]; };
const worldPoint = (ev) => canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY });
/** A screen distance in art pixels. */
const artPx = (screenPx) => screenPx / zoom() / S().px;

export const selectedRod = () => selected;

function commit(list, { snapshot = true } = {}) {
  if ( snapshot ) undo.push(clone(rods())), undo.length > UNDO_MAX && undo.shift();
  attach(list);
  Water.setParams({ guides: clone(list), ...(list.length ? { guideOn: true } : {}) });
  draw(); Hooks.callAll("moinenMapsRods");
}

/* ---------------------------------------------------------------- drawing */

function draw() {
  if ( !gfx ) return;
  gfx.clear();
  const s = S(); if ( !s || !active() ) return;
  const z = zoom(), list = rods();
  list.forEach((r, i) => {
    const c = sample(r.pts, 2), lip = r.kind === "lip", sel = i === selected;
    const color = sel ? 0xFFFFFF : lip ? 0xFFA63D : 0x46D0D0;
    gfx.lineStyle({ width: 4 / z, color: 0x15110F, alpha: 0.7, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
    c.xs.forEach((x, k) => { const [wx, wy] = toWorld(x, c.ys[k]); k ? gfx.lineTo(wx, wy) : gfx.moveTo(wx, wy); });
    gfx.lineStyle({ width: 2 / z, color, alpha: 1, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
    c.xs.forEach((x, k) => { const [wx, wy] = toWorld(x, c.ys[k]); k ? gfx.lineTo(wx, wy) : gfx.moveTo(wx, wy); });
    // the way the water runs: an arrowhead at the end of a flow rod
    const n = c.xs.length;
    if ( !lip && n > 2 ) {
      const [ex, ey] = toWorld(c.xs[n - 1], c.ys[n - 1]), [px, py] = toWorld(c.xs[Math.max(0, n - 4)], c.ys[Math.max(0, n - 4)]);
      const a = Math.atan2(ey - py, ex - px), L = 12 / z;
      gfx.lineStyle({ width: 2 / z, color, alpha: 1, cap: PIXI.LINE_CAP.ROUND });
      for ( const da of [2.6, -2.6] ) { gfx.moveTo(ex, ey); gfx.lineTo(ex + Math.cos(a + da) * L, ey + Math.sin(a + da) * L); }
    }
    gfx.lineStyle(0);
    for ( let k = 0; k < (r.pts.length >> 1); k++ ) {
      const [wx, wy] = toWorld(r.pts[k * 2], r.pts[k * 2 + 1]);
      const isHover = hover && hover.rod === i && hover.pt === k;
      gfx.lineStyle({ width: 1.5 / z, color: 0x15110F, alpha: 1 });
      gfx.beginFill(isHover ? 0xFFE08A : color, 1).drawCircle(wx, wy, (isHover ? 6 : 4.5) / z).endFill();
    }
  });
}

/* ---------------------------------------------------------------- hit testing */

function hitDot(x, y) {
  const r = artPx(DOT_PX);
  let best = null;
  rods().forEach((rod, i) => {
    for ( let k = 0; k < (rod.pts.length >> 1); k++ ) {
      const d = Math.hypot(rod.pts[k * 2] - x, rod.pts[k * 2 + 1] - y);
      if ( d <= r && (!best || d < best.d) ) best = { rod: i, pt: k, d };
    }
  });
  return best;
}

function hitLine(x, y) {
  const r = artPx(REACH_PX);
  let best = null;
  rods().forEach((rod, i) => {
    const n = nearest(chain(rod), x, y);
    if ( n.d <= r && (!best || n.d < best.d) ) best = { rod: i, ...n };
  });
  return best;
}

/* ---------------------------------------------------------------- pointer handling */

async function onDown(ev) {
  if ( !active() ) return;
  if ( ev.button !== 0 && ev.button !== 2 ) return;
  ev.stopImmediatePropagation(); ev.preventDefault();
  await Water.ensureState();
  if ( !S() ) return;
  const [x, y] = toArt(worldPoint(ev));
  const list = clone(rods());
  const dot = hitDot(x, y), line = dot ? null : hitLine(x, y);
  if ( ev.button === 2 ) {
    if ( dot ) {
      const r = list[dot.rod];
      if ( (r.pts.length >> 1) <= 2 ) { selected = -1; return commit(removeRod(list, dot.rod)); }
      r.pts.splice(dot.pt * 2, 2);
      if ( dot.pt === 0 ) { delete r.parent; delete r.at; }
      selected = dot.rod; return commit(list);
    }
    if ( line ) { selected = -1; return commit(removeRod(list, line.rod)); }
    return;
  }
  const snapshot = clone(rods());
  if ( dot ) {
    const r = list[dot.rod], n = r.pts.length >> 1;
    selected = dot.rod;
    if ( ev.shiftKey && (dot.pt === n - 1 || dot.pt === 0) ) {
      // a new dot past the end: the rod grows
      if ( dot.pt === 0 ) { r.pts.unshift(r.pts[0], r.pts[1]); delete r.parent; delete r.at; drag = { list, snapshot, rod: dot.rod, pt: 0 }; }
      else { r.pts.push(r.pts[n * 2 - 2], r.pts[n * 2 - 1]); drag = { list, snapshot, rod: dot.rod, pt: n }; }
    } else drag = { list, snapshot, rod: dot.rod, pt: dot.pt };
  } else if ( line ) {
    selected = line.rod;
    const r = list[line.rod];
    if ( (ev.altKey || opt("waterRodBranch")) && r.kind !== "lip" ) {
      list.push({ pts: [line.x, line.y, line.x, line.y], parent: line.rod + 1, at: line.at });
      drag = { list, snapshot, rod: list.length - 1, pt: 1 };
      selected = list.length - 1;
    } else {
      r.pts.splice(line.span * 2, 0, line.x, line.y);       // a new dot between control points `span` and `span + 1`
      drag = { list, snapshot, rod: line.rod, pt: line.span };
    }
  } else {
    const kind = opt("waterRodKind") === "lip" ? "lip" : undefined;
    list.push({ pts: [x, y, x, y], ...(kind ? { kind } : {}) });
    selected = list.length - 1;
    drag = { list, snapshot, rod: selected, pt: 1 };
  }
  drag.moved = false;
  S().params.guides = list;      // shown live; set properly on release
  draw();
}

function onMove(ev) {
  if ( !active() || !S() ) return;
  const [x, y] = toArt(worldPoint(ev));
  if ( drag ) {
    const r = drag.list[drag.rod]; if ( !r ) return;
    drag.moved = true;
    if ( drag.pt === 0 && r.parent ) {
      // the first dot of a branch slides along its parent
      const par = drag.list[r.parent - 1];
      if ( par ) { const n = nearest(chain(par), x, y); r.at = n.at; }
    } else { r.pts[drag.pt * 2] = x; r.pts[drag.pt * 2 + 1] = y; }
    attach(drag.list);
    draw();
    return;
  }
  const dot = hitDot(x, y);
  const next = dot ? { rod: dot.rod, pt: dot.pt } : null;
  if ( (next?.rod !== hover?.rod) || (next?.pt !== hover?.pt) ) { hover = next; draw(); }
}

function onUp(ev) {
  if ( !drag ) return;
  const d = drag; drag = null;
  const list = d.list;
  // a rod too short to mean anything (a click) is dropped
  const r = list[d.rod];
  if ( r && !d.moved && r.pts.length === 4 && r.pts[0] === r.pts[2] && r.pts[1] === r.pts[3] ) { S().params.guides = clone(d.snapshot); draw(); return; }
  undo.push(d.snapshot); if ( undo.length > UNDO_MAX ) undo.shift();
  if ( r && chain(r).len < 1.5 && !r.parent ) { const k = list.indexOf(r); selected = -1; return commit(removeRod(list, k), { snapshot: false }); }
  commit(list, { snapshot: false });
}

function cancelDrag() {
  if ( !drag ) return;
  S().params.guides = clone(drag.snapshot); drag = null; draw();
}

/* ---------------------------------------------------------------- commands (also used by the settings window) */

export function reverseSelected() {
  const list = clone(rods());
  if ( selected < 0 || !list[selected] ) return;
  reverseRod(list, selected);
  commit(list);
}

export function undoRod() {
  const prev = undo.pop(); if ( !prev || !S() ) return;
  selected = -1;
  commit(prev, { snapshot: false });
}

export function clearRods() {
  if ( !rods().length ) return;
  selected = -1;
  commit([]);
}

/* ---------------------------------------------------------------- lifecycle */

export function syncRodTool() {
  const on = active();
  if ( on && !gfx && canvas.interface ) {
    gfx = new PIXI.Graphics(); gfx.eventMode = "none"; gfx.zIndex = 850;
    canvas.interface.sortableChildren = true; canvas.interface.addChild(gfx);
  }
  if ( !on ) { hover = null; drag = null; }
  document.body.classList.toggle("mm-painting-rods", on);
  if ( gfx ) draw();
}

export function onCanvasReady() {
  teardown();
  if ( !game.user.isGM ) return;
  const view = canvas.app.view;
  listeners = {
    down: onDown, move: onMove, up: onUp, cancel: cancelDrag,
    menu: (e) => { if ( active() ) e.preventDefault(); },
    key: (e) => {
      if ( !active() || (e.target instanceof HTMLElement && /^(input|textarea|select)$/i.test(e.target.tagName)) ) return;
      if ( (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" ) { e.preventDefault(); e.stopPropagation(); undoRod(); }
      else if ( e.key === "Escape" && drag ) { cancelDrag(); e.preventDefault(); e.stopPropagation(); }
      else if ( (e.key === "Delete" || e.key === "Backspace") && selected >= 0 ) { e.preventDefault(); e.stopPropagation(); const list = clone(rods()); const k = selected; selected = -1; commit(removeRod(list, k)); }
    }
  };
  view.addEventListener("pointerdown", listeners.down, true);
  view.addEventListener("pointermove", listeners.move);
  view.addEventListener("contextmenu", listeners.menu, true);
  window.addEventListener("pointerup", listeners.up);
  window.addEventListener("pointercancel", listeners.cancel);
  window.addEventListener("keydown", listeners.key, true);
  Hooks.on("canvasPan", draw);
  Hooks.on("moinenMapsWater", draw);
}

export function teardown() {
  if ( listeners ) {
    const v = canvas.app?.view;
    v?.removeEventListener("pointerdown", listeners.down, true); v?.removeEventListener("pointermove", listeners.move);
    v?.removeEventListener("contextmenu", listeners.menu, true);
    window.removeEventListener("pointerup", listeners.up); window.removeEventListener("pointercancel", listeners.cancel);
    window.removeEventListener("keydown", listeners.key, true);
    listeners = null;
    Hooks.off("canvasPan", draw); Hooks.off("moinenMapsWater", draw);
  }
  if ( gfx && !gfx.destroyed ) gfx.destroy({ children: true });
  gfx = null; drag = null; hover = null; selected = -1; undo.length = 0;
  document.body.classList.remove("mm-painting-rods");
}
