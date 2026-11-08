import { MODULE_ID } from "../config.mjs";
import { api as moduleApi } from "../attrs.mjs";
import * as Model from "./model.mjs";
import * as Geo from "./geometry.mjs";
import { ZoneDisplay } from "./display.mjs";
import { preset, presets, zonesText } from "./presets.mjs";
import * as Editor from "./editor.mjs";

/**
 * Zones of the open scene. The GM draws loose pencil lines (scripts/zones/editor.mjs); every area the lines close off is a zone
 * (scripts/zones/geometry.mjs). Zones count movement the Year Zero way: the distance between two tokens is the number of zone
 * borders on the shortest route. The scene's preset (scripts/zones/presets.mjs) says what a distance costs: the badges of a selected
 * token's surroundings and the token ruler's label show it.
 *
 * Inside the Zones workspace section the GM sees the raw pencil lines; everywhere else (and for players) only the finished zones.
 * Public API: `game.modules.get("moinen-maps").api.zones`. Hook "moinenMapsZones" with ("loaded" | "edited" | "params" | "section").
 */

let S = null, Z = null, display = null, saveTimer = 0, inSection = false, hover = -1, hoverRaf = 0, hoverAt = null;
let saveSceneId = null, lastSaved = "";
const undo = [], redo = [];
const UNDO_MAX = 60;

export const tell = (kind) => Hooks.callAll("moinenMapsZones", kind);
export const state = () => S;
export const zones = () => Z;
export const editing = () => inSection && !!game.user?.isGM;
export const gridSize = () => canvas.dimensions?.size ?? canvas.grid?.size ?? 100;

/* ---------------------------------------------------------------- settings */

function registerSettings() {
  const R = (k, type, def, onChange) => game.settings.register(MODULE_ID, k, { scope: "client", config: false, type, default: def, onChange });
  R("zonesDistances", Boolean, true, () => { refresh(); tell("params"); });
  R("zonesEraser", Number, 0.5, () => tell("params"));
  R("zonesRuler", Boolean, true, () => tell("params"));
}
export const setting = (k, d) => { try { return game.settings.get(MODULE_ID, k); } catch { return d; } };

/* ---------------------------------------------------------------- the zones of the lines */

function rebuild() {
  const g = gridSize();
  // smoothing works on screen-sized steps of the line (scene pixels), so it looks the same on small- and large-grid maps
  const step = Math.max(3, Math.min(g * 0.15, 12));
  const lines = S ? [...S.strokes.values()].map((p) => Geo.smoothLine(p, S.smooth, step)) : [];
  Z = S && S.strokes.size ? Geo.buildZones(lines, { snap: S.snap * g, merge: 0.5, minArea: 0.15 * g * g }) : null;
}

/** Who sees the finished zones: always the GM drawing them, else as the scene says. */
export function visibleToMe() {
  if ( !S || !Z ) return false;
  if ( editing() ) return true;
  const who = S.look.who;
  return who === "all" || (who === "gm" && game.user.isGM);
}

/** The one token selected (and owned) on this client, or null. */
function selectedToken() {
  const c = canvas.tokens?.controlled ?? [];
  return c.length === 1 && c[0].isOwner ? c[0] : null;
}

/** A token's centre where it stands (its document, not the animation). */
export function tokenCenter(t) {
  const d = t.document, g = gridSize();
  return { x: d.x + (d.width * g) / 2, y: d.y + (d.height * g) / 2 };
}

export function movesOf(actor) {
  const p = preset(S?.preset);
  try { return p?.moves(actor) ?? []; } catch { return []; }
}

/** Draw again: the zones, and the distances around the selected token. */
export function refresh() {
  if ( !display ) return;
  display.visible = visibleToMe();
  if ( !display.root.visible ) return;
  let dist = null, bands = null, here = -1;
  const t = setting("zonesDistances", true) ? selectedToken() : null;
  if ( t && Z ) {
    const c = tokenCenter(t);
    here = Geo.zoneAt(Z, c.x, c.y);
    if ( here >= 0 ) {
      dist = Geo.distances(Z, here);
      const p = preset(S.preset), moves = movesOf(t.actor);
      if ( p ) { bands = new Map(); for ( const [id, d] of dist ) { const b = p.band(d, moves); if ( b ) bands.set(id, b); } }
    }
  }
  display.render(Z, S.look, gridSize(), { dist, bands, here, hover, editing: editing(), zoom: canvas.stage.scale.x });
}

/* ---------------------------------------------------------------- numbers on hover */

/** The zone under the cursor (numbers "hover"): one check per frame at most, a redraw only when it changes. */
function onHoverMove(ev) {
  if ( S?.look.numbers !== "hover" || !display?.root.visible ) return;
  hoverAt = { x: ev.clientX, y: ev.clientY };
  if ( hoverRaf ) return;
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0;
    if ( !hoverAt || !canvas.ready ) return;
    const p = canvas.canvasCoordinatesFromClient(hoverAt);
    setHover(Geo.zoneAt(Z, p.x, p.y));
  });
}
function setHover(id) { if ( id === hover ) return; hover = id; refresh(); }
const onHoverLeave = () => { hoverAt = null; if ( hover >= 0 ) setHover(-1); };

/* ---------------------------------------------------------------- lifecycle */

function onCanvasReady() {
  teardown();
  if ( !canvas.scene ) return;
  S = Model.load(canvas.scene);
  lastSaved = JSON.stringify(Model.encode(S));
  display = new ZoneDisplay();
  hover = -1;
  canvas.app.view.addEventListener("pointermove", onHoverMove, { passive: true });
  canvas.app.view.addEventListener("pointerleave", onHoverLeave);
  rebuild(); refresh();
  Editor.onCanvasReady();
  tell("loaded");
}

function teardown() {
  flushSave();
  clearTimeout(saveTimer); saveTimer = 0;
  Editor.teardown();
  canvas.app?.view?.removeEventListener("pointermove", onHoverMove);
  canvas.app?.view?.removeEventListener("pointerleave", onHoverLeave);
  cancelAnimationFrame(hoverRaf); hoverRaf = 0; hoverAt = null; hover = -1;
  display?.destroy(); display = null;
  S = Z = null;
  undo.length = redo.length = 0;
}

function onUpdateScene(scene, changed, _o, userId) {
  if ( scene.id !== canvas.scene?.id || !S ) return;
  const f = changed.flags?.[MODULE_ID];
  if ( !f || !(Model.FLAG in f || `-=${Model.FLAG}` in f) ) return;
  if ( userId === game.user.id ) return;
  S = Model.load(scene);
  lastSaved = JSON.stringify(Model.encode(S));
  rebuild(); refresh(); tell("loaded");
}

/* ---------------------------------------------------------------- editing (GM) */

const snapshot = () => JSON.stringify(Model.encode(S));
const restore = (text) => { S = Model.load({ flags: { [MODULE_ID]: { [Model.FLAG]: JSON.parse(text) } } }); };

/**
 * Change the lines: `fn(strokes, S)` edits a copy (a Map id -> points) and returns true when it changed something. One undo step.
 */
export function edit(fn) {
  if ( !game.user.isGM || !S ) return false;
  const before = snapshot();
  const next = Model.canonical(S);
  if ( !fn(next.strokes, next) ) return false;
  undo.push(before); if ( undo.length > UNDO_MAX ) undo.shift();
  redo.length = 0;
  S = Model.canonical(next);
  rebuild(); refresh(); scheduleSave(); tell("edited");
  return true;
}

export function undoEdit() { const s = undo.pop(); if ( !s || !S ) return false; redo.push(snapshot()); restore(s); rebuild(); refresh(); scheduleSave(); tell("edited"); return true; }
export function redoEdit() { const s = redo.pop(); if ( !s || !S ) return false; undo.push(snapshot()); restore(s); rebuild(); refresh(); scheduleSave(); tell("edited"); return true; }
export const canUndo = () => undo.length > 0;
export const canRedo = () => redo.length > 0;

/** A new pencil line. */
export function addStroke(pts) {
  if ( !Array.isArray(pts) || pts.length < 4 ) return false;
  return edit((st, s) => { st.set(s.next++, pts.slice()); return true; });
}

/** Cut the lines along an eraser trail of radius r (scene pixels): every piece of line within r goes, the rest stays as pieces. */
export function eraseAlong(trail, r) {
  return edit((st, s) => {
    let changed = false;
    const near = (x, y) => {
      if ( trail.length === 2 ) return Math.hypot(x - trail[0], y - trail[1]) <= r;
      for ( let i = 2; i < trail.length; i += 2 ) {
        const ax = trail[i - 2], ay = trail[i - 1], bx = trail[i], by = trail[i + 1];
        const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
        const t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
        if ( Math.hypot(x - ax - dx * t, y - ay - dy * t) <= r ) return true;
      }
      return false;
    };
    const step = Math.max(1, r / 3);
    for ( const [id, p] of [...st] ) {
      // densify, so a cut lands within a third of the eraser of where it was meant
      const d = [p[0], p[1]];
      for ( let i = 2; i < p.length; i += 2 ) {
        const ax = p[i - 2], ay = p[i - 1], bx = p[i], by = p[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
        for ( let k = 1; k <= n; k++ ) d.push(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
      }
      const pieces = []; let cur = [], hit = false;
      for ( let i = 0; i < d.length; i += 2 ) {
        if ( near(d[i], d[i + 1]) ) { hit = true; if ( cur.length >= 4 ) pieces.push(cur); cur = []; }
        else cur.push(d[i], d[i + 1]);
      }
      if ( cur.length >= 4 ) pieces.push(cur);
      if ( !hit ) continue;
      changed = true;
      st.delete(id);
      for ( const q of pieces ) st.set(s.next++, Geo.simplify(q, 0.6));
    }
    return changed;
  });
}

/** Trim: keep only the lines that bound zones (everything sticking out goes). */
export function trim() {
  if ( !Z ) return false;
  const core = Z.core.map((p) => Geo.simplify(p, 0.3)).filter((p) => p.length >= 4);
  return edit((st, s) => {
    const before = JSON.stringify([...st.values()]);
    st.clear();
    for ( const p of core ) st.set(s.next++, p);
    return JSON.stringify([...st.values()]) !== before;
  });
}

export const clearAll = () => edit((st) => { if ( !st.size ) return false; st.clear(); return true; });

/** Scene settings: preset, snap, look. */
export function setParams(patch) {
  if ( !game.user.isGM || !S ) return;
  const next = Model.canonical(S);
  if ( patch.preset != null && preset(patch.preset) ) next.preset = patch.preset;
  if ( patch.smooth != null ) next.smooth = Math.min(1, Math.max(0, Number(patch.smooth) || 0));
  if ( patch.snap != null ) next.snap = Math.min(Model.LIMITS.snap[1], Math.max(Model.LIMITS.snap[0], Number(patch.snap) || 0));
  if ( patch.look ) next.look = Model.cleanLook({ ...next.look, ...patch.look });
  if ( JSON.stringify(Model.encode(next)) === snapshot() ) return;
  const snapChanged = next.snap !== S.snap || next.smooth !== S.smooth;
  S = Model.canonical(next);
  if ( snapChanged ) rebuild();
  refresh(); scheduleSave(); tell("params");
}

function scheduleSave(ms = 400) {
  clearTimeout(saveTimer);
  saveSceneId = canvas.scene?.id ?? null;
  saveTimer = setTimeout(() => { saveTimer = 0; save(); }, ms);
}

export async function save() {
  if ( !game.user.isGM || !S ) return;
  const scene = game.scenes.get(saveSceneId) ?? canvas.scene;
  if ( !scene ) return;
  const payload = Model.encode(S), text = JSON.stringify(payload);
  if ( text === lastSaved ) return;
  lastSaved = text;
  try { await scene.update({ [`flags.${MODULE_ID}.${Model.FLAG}`]: payload }); }
  catch ( err ) { lastSaved = ""; console.warn(`${MODULE_ID} | could not save the zones`, err); }
}

function flushSave() { if ( !saveTimer ) return; clearTimeout(saveTimer); saveTimer = 0; save(); }

/* ---------------------------------------------------------------- the section (raw lines inside, finished zones outside) */

export function setInSection(on) {
  on = !!on;
  if ( on === inSection ) return;
  inSection = on;
  refresh(); Editor.redraw(); tell("section");
}

/* ---------------------------------------------------------------- the token ruler: distance in zones */

/**
 * Zones between the explicit waypoints of a token's move, each leg counted on the shortest route; null when a point lies outside
 * every zone (the ruler then keeps its own label).
 */
function legsInZones(waypoint) {
  const pts = [];
  for ( let w = waypoint; w; w = w.previous ) if ( w === waypoint || w.explicit || !w.previous ) pts.unshift(w.center);
  let n = 0;
  for ( let i = 1; i < pts.length; i++ ) {
    const d = Geo.zoneDistance(Z, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
    if ( d == null ) return null;
    n += d;
  }
  return n;
}

function patchRuler() {
  const cls = CONFIG.Token?.rulerClass;
  const proto = cls?.prototype;
  if ( !proto || typeof proto._getWaypointLabelContext !== "function" || proto._mmZones ) return;
  const orig = proto._getWaypointLabelContext;
  proto._mmZones = true;
  proto._getWaypointLabelContext = function(waypoint, state) {
    const ctx = orig.call(this, waypoint, state);
    try {
      if ( !ctx || !Z || !setting("zonesRuler", true) || !visibleToMe() || !waypoint.previous ) return ctx;
      const n = legsInZones(waypoint);
      if ( n == null ) return ctx;
      const band = preset(S.preset)?.band(n, movesOf(this.token?.actor));
      ctx.cost = { total: zonesText(n), units: band?.cost ? `· ${band.cost}` : "" };
      ctx.distance = { total: zonesText(n) };
      ctx.cssClass = `${ctx.cssClass ?? ""} mm-zones-label`;
    } catch ( err ) { console.warn(`${MODULE_ID} | zones ruler label`, err); }
    return ctx;
  };
}

/* ---------------------------------------------------------------- public API */

export const zonesApi = {
  /** The decoded scene data (lines, preset, look) and the zones worked out from them. */
  state: () => (S ? Model.encode(S) : null),
  zones: () => Z,
  /** The zone at a scene point (-1: none), and zones between two points (null: outside, or no route). */
  zoneAt: (x, y) => Geo.zoneAt(Z, x, y),
  distance: (ax, ay, bx, by) => Geo.zoneDistance(Z, ax, ay, bx, by),
  /** Zones between two tokens. */
  tokenDistance(a, b) { const p = tokenCenter(a), q = tokenCenter(b); return Geo.zoneDistance(Z, p.x, p.y, q.x, q.y); },
  /** What a move of `d` zones costs this actor under the scene's preset. */
  band: (d, actor) => preset(S?.preset)?.band(d, movesOf(actor)) ?? null,
  moves: (actor) => movesOf(actor),
  presets: () => presets().map((p) => ({ id: p.id, title: game.i18n.localize(p.title) })),
  addStroke, erase: eraseAlong, trim, clear: clearAll, undo: undoEdit, redo: redoEdit, setParams,
  refresh,
  /** Pure geometry, for tests and other modules. */
  geometry: Geo
};

export function registerZones() {
  moduleApi.zones = zonesApi;
  Hooks.once("init", registerSettings);
  Hooks.once("setup", patchRuler);
  Hooks.once("ready", () => { patchRuler(); const m = game.modules.get(MODULE_ID); if ( m ) { m.api ??= moduleApi; m.api.zones ??= zonesApi; } });
  Hooks.on("canvasReady", onCanvasReady);
  Hooks.on("canvasTearDown", teardown);
  Hooks.on("updateScene", onUpdateScene);
  Hooks.on("controlToken", () => refresh());
  // badges and lines keep their size on screen: draw again when the zoom moved by more than ~8 %
  Hooks.on("canvasPan", () => { const z = canvas.stage?.scale.x ?? 1, d = display?.zoom; if ( display?.root.visible && d && Math.abs(Math.log(z / d)) > 0.08 ) refresh(); });
  Hooks.on("updateToken", (doc, changed) => { if ( ("x" in changed || "y" in changed) && doc.object?.controlled ) refresh(); });
  Hooks.on("updateItem", (item) => { if ( item.parent && canvas.tokens?.controlled.some((t) => t.actor === item.parent) ) refresh(); });
  window.addEventListener("beforeunload", () => flushSave());
  document.addEventListener("visibilitychange", () => { if ( document.visibilityState === "hidden" ) flushSave(); });
}
