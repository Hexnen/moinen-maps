import { MODULE_ID } from "../config.mjs";
import { api as moduleApi } from "../attrs.mjs";
import * as M from "./model.mjs";
import { FireDisplay } from "./display.mjs";
import { sharedNow } from "../shared-clock.mjs";
import * as DModel from "../destruction/model.mjs";
import * as D from "../destruction/destruction.mjs";
import { reducedMotion } from "../config.mjs";

/**
 * FIRE AND SMOKE, the engine: the strokes of the open scene (scene flags, model.mjs), the display (display.mjs), the GM's edits
 * (each stroke one flag key; undo / redo of whole strokes; a clear), other clients' saves followed. Nothing is baked, published or
 * uploaded: every client computes the same areas and fields from the same strokes, and the same frame from the shared clock.
 * Public API: `game.modules.get("moinen-maps").api.fire`. Hook fired: "moinenMapsFire" ("loaded" | "edited" | "params" | "brush").
 */
let strokes = new Map();            // id -> stroke (stored)
let params = M.cleanParams();
let draft = null;                   // the stroke being painted (not stored yet)
let display = null;
let fields = new Map();             // area key -> field (cache: an unchanged area is not rasterized again)
let lastAreas = [];
let drawFrame = 0;
const undoStack = [], redoStack = [];
const UNDO_MAX = 100;
let extra = new Map();              // other sources of fire (a destruction stroke later on): id -> { area, field }
let phaseTimer = 0;                 // the next phase change (a stroke done growing / gone out): one redraw then
let purging = false;

export const tell = (kind) => Hooks.callAll("moinenMapsFire", kind);
export const params0 = () => params;
export const list = () => [...strokes.values()].filter((s) => s.o === undefined).sort(M.byOrder);

/** The art grid this layer draws on: the destruction layer's (same ap, same origin), else the formula it would use. */
export function geo() {
  const r = DModel.sceneRect(), ap = D.state()?.ap ?? DModel.artPx();
  return { ap, ox: r.x, oy: r.y, grid: canvas.grid?.size ?? 100 };
}

/** Does this client show the layer? */
const shown = () => params.on && (params.who !== "gm" || game.user.isGM);

/* ---------------------------------------------------------------- load / follow */

function load(scene = canvas.scene) {
  const F = scene?.flags?.[MODULE_ID] ?? {};
  params = M.cleanParams(F[M.FLAG]);
  strokes = new Map(M.strokesOf(F[M.STROKES]).map((s) => [s.id, s]));
}

function onCanvasReady() {
  teardown();
  if ( !canvas.scene ) return;
  load();
  draw();
  tell("loaded");
}

function teardown() {
  cancelAnimationFrame(drawFrame); drawFrame = 0;
  clearTimeout(phaseTimer); phaseTimer = 0;
  display?.destroy(); display = null;
  fields.clear(); lastAreas = []; draft = null;
  undoStack.length = redoStack.length = 0;
}

function onUpdateScene(scene, changed) {
  if ( scene.id !== canvas.scene?.id ) return;
  const f = changed?.flags?.[MODULE_ID]; if ( !f ) return;
  if ( ![M.FLAG, M.STROKES, `-=${M.STROKES}`, `-=${M.FLAG}`].some((k) => k in f) ) return;
  load(scene);
  scheduleDraw();
  tell(M.FLAG in f ? "params" : "edited");
}

/* ---------------------------------------------------------------- drawing */

export function scheduleDraw() {
  if ( drawFrame ) return;
  drawFrame = requestAnimationFrame(() => { drawFrame = 0; draw(); });
}

/**
 * Compute the areas at this moment (phases from the shared clock: growing, burning, going out) and the fields of the new ones, and
 * show them. With nothing to show the display is not even made. The next phase change is one timer (a redraw then: a new field
 * without the times texture once a stroke has grown, the stroke gone once it is out), never a per-frame cost.
 */
export function draw() {
  if ( !canvas.ready || !canvas.scene ) return;
  const all = [...strokes.values()]; if ( draft ) all.push(draft);
  const now = sharedNow(), still = reducedMotion(), g = geo();
  clearTimeout(phaseTimer); phaseTimer = 0;
  const next = M.nextChange(all, now, g, params, still);
  if ( Number.isFinite(next) ) phaseTimer = setTimeout(() => { phaseTimer = 0; draw(); }, Math.min(2 ** 31 - 1, Math.max(16, next - now + 20)));
  purge(now, g);
  const areas = shown() ? M.areasOf(all.sort(M.byOrder), g, params, now, still) : [];
  const has = areas.length > 0 || (shown() && extra.size > 0);
  if ( !has ) { if ( display ) { display.destroy(); display = null; } lastAreas = []; fields.clear(); return; }
  const keep = new Map(), items = [];
  for ( const a of areas ) {
    const f = fields.get(a.key) ?? M.raster(a, g, params);
    keep.set(a.key, f); items.push({ area: a, field: f });
  }
  for ( const it of extra.values() ) items.push(it);
  fields = keep; lastAreas = areas;
  display ??= new FireDisplay();
  display.sync(items, g, params);
}

/* ---------------------------------------------------------------- edits (GM) */

const sKey = (id) => `flags.${MODULE_ID}.${M.STROKES}.${id}`;
async function write(upd) {
  if ( !game.user.isGM || !canvas.scene ) return;
  try { await canvas.scene.update(upd); } catch ( err ) { console.warn(`${MODULE_ID} | fire: could not save`, err); }
}

/** A new stroke id: short, unique enough (time + random). */
export const newId = () => `f${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/** The stroke being painted (the editor): shown at once, stored on `commit`. null clears it. */
let draftAt = 0, draftTimer = 0;
export function setDraft(st) {
  draft = st ? M.cleanStroke({ ...st, id: "draft", q: st.q ?? sharedNow() }) : null;
  // (a big area takes ~25 ms to rasterize: while painting, at most ~12 redraws a second)
  clearTimeout(draftTimer);
  const wait = 80 - (performance.now() - draftAt);
  if ( !draft || wait <= 0 ) { draftAt = performance.now(); scheduleDraw(); }
  else draftTimer = setTimeout(() => { draftAt = performance.now(); scheduleDraw(); }, wait);
}

/** The GM removes the records of strokes whose going-out animation is over (one write; other clients already show them gone). */
function purge(now, g) {
  if ( !game.user.isGM || purging || !canvas.scene ) return;
  const gone = M.goneAt([...strokes.values()], now, g, params);
  if ( !gone.length ) return;
  for ( const s of gone ) strokes.delete(s.id);
  purging = true;
  write(Object.fromEntries(gone.map((s) => [`flags.${MODULE_ID}.${M.STROKES}.-=${s.id}`, null]))).finally(() => { purging = false; });
}

/** Store a stroke (one flag key). */
export function add(raw, { undoable = true } = {}) {
  const st = M.cleanStroke({ ...raw, q: raw.q ?? sharedNow(), id: raw.id && raw.id !== "draft" ? raw.id : newId() });
  if ( !st || !game.user.isGM ) return null;
  strokes.set(st.id, st); draft = null;
  if ( undoable ) { undoStack.push({ add: [st] }); if ( undoStack.length > UNDO_MAX ) undoStack.shift(); redoStack.length = 0; }
  draw(); tell("edited");
  write({ [sKey(st.id)]: st });
  return st;
}

/**
 * PUT OUT strokes by id (delete, clear, undo of a paint): each keeps its record with its out time `o` (one write) and goes out on
 * every client - the flames sink, the embers darken, the smoke drifts away - then the GM removes the records (`purge`).
 */
export function remove(ids, { undoable = true } = {}) {
  const gone = (Array.isArray(ids) ? ids : [ids]).map((id) => strokes.get(id)).filter((s) => s && s.o === undefined);
  if ( !gone.length || !game.user.isGM ) return 0;
  if ( undoable ) { undoStack.push({ del: gone }); redoStack.length = 0; }
  putOut(gone);
  return gone.length;
}
function putOut(list) {
  const now = Math.round(sharedNow()), upd = {};
  for ( const s of list ) { const o = { ...s, o: now }; strokes.set(s.id, o); upd[sKey(s.id)] = o; }
  draw(); tell("edited");
  write(upd);
}
/** Bring strokes back (undo of a delete, redo of a paint): they keep their place in the paint order and grow again from now. */
function relight(list) {
  const now = Math.round(sharedNow()), upd = {};
  for ( const s of list ) { const { o, ...rest } = s; const st = M.cleanStroke({ ...rest, g: now }); strokes.set(st.id, st); upd[sKey(st.id)] = st; }
  draw(); tell("edited");
  write(upd);
}

/** Change a stroke's fire / smoke level afterwards (the dock list): one write, the area is drawn again (no animation). */
export function setLevels(id, { lv, sm } = {}) {
  const s = strokes.get(id); if ( !s || !game.user.isGM || s.o !== undefined ) return null;
  const st = M.cleanStroke({ ...s, ...(lv !== undefined ? { lv } : {}), ...(sm !== undefined ? { sm } : {}) });
  strokes.set(id, st); draw(); tell("edited");
  write({ [sKey(id)]: st });
  return st;
}

/** Every stroke goes out (one undo step). */
export function clear() { return remove([...strokes.values()].filter((s) => s.o === undefined).map((s) => s.id)); }

/** Undo / redo of whole strokes, with the same animations: what comes back grows, what goes away goes out. */
function apply(step, back) {
  const addL = back ? step.del : step.add, delL = back ? step.add : step.del;
  if ( delL?.length ) putOut(delL.map((s) => strokes.get(s.id)).filter((s) => s && s.o === undefined));
  if ( addL?.length ) relight(addL);
}
export function undo() { const s = undoStack.pop(); if ( !s ) return false; redoStack.push(s); apply(s, true); return true; }
export function redo() { const s = redoStack.pop(); if ( !s ) return false; undoStack.push(s); apply(s, false); return true; }

/** Change the layer's settings (GM): stored in the scene flag; every client redraws. */
export function setParams(patch) {
  if ( !game.user.isGM ) return;
  params = M.cleanParams({ ...params, ...patch });
  fields.clear();   // (flame height, plume, smoke change the fields)
  draw(); tell("params");
  write({ [`flags.${MODULE_ID}.${M.FLAG}`]: { v: M.VERSION, ...params } });
}

/**
 * ANOTHER SOURCE of fire (the hook for a destruction stroke that burns, later): a field (model.fieldFromMask / fieldFrom) over a
 * rectangle of cells, shown by the same display with its own id. null removes it. Not stored: the caller computes it on every client.
 */
export function setExtra(id, area, field) {
  if ( !area || !field ) extra.delete(id); else extra.set(id, { area: { id: `x:${id}`, key: `x:${id}:${area.key ?? ""}`, seed: 1, wind: [0, 0], ...area }, field });
  scheduleDraw();
}

/* ---------------------------------------------------------------- the api */

export const fireApi = {
  /**
   * Paint a stroke from a macro: `points` = [[x, y], ...] or { x, y } (scene px); `kind` "fire" | "smoke" | "erase"; `radius` scene
   * px; `strength` 0.1..1; `wind` { dir (degrees, 0 = right, 90 = down), speed 0..1 }. Returns the stored stroke (or null).
   */
  paint(points, { kind = "fire", radius = 50, strength = 0.8, wind = null, level = 2, smoke = 2, style = "fire" } = {}) {
    const pts = Array.isArray(points) ? points : [[points.x, points.y]];
    const w = wind ?? { dir: game.settings.get(MODULE_ID, "fireWindDir"), speed: game.settings.get(MODULE_ID, "fireWind") };
    return add({ k: kind, r: radius, s: strength, p: pts.flatMap(([x, y]) => [x, y]), wd: w.dir ?? 0, ws: w.speed ?? 0, lv: level, sm: smoke, st: style });
  },
  /** Change a stroke's levels afterwards: `{ level, smoke }`. */
  setLevels: (id, { level, smoke } = {}) => setLevels(id, { lv: level, sm: smoke }),
  erase(x, y, radius = 50) { return add({ k: "erase", r: radius, s: 1, p: [x, y] }); },
  remove: (id) => remove(id), clear, undo, redo,
  list: () => list().map((s) => ({ ...s, p: [...s.p] })),
  params: () => ({ ...params }), setParams,
  /** How it stands: strokes, areas, what is drawn, particles, lights, the last tick's ms. */
  status: () => ({ strokes: strokes.size, out: [...strokes.values()].filter((s) => s.o !== undefined).length, animating: lastAreas.filter((a) => Object.values(a.phases ?? {}).some((p) => p !== "on")).length, areas: lastAreas.length, shown: shown(), on: params.on, who: params.who, ...(display?.stats ?? { visible: 0, particles: 0, lights: 0, tickMs: 0 }), display: !!display }),
  display: () => display,
  geo, setExtra, model: M
};

export function registerFire() {
  moduleApi.fire = fireApi;
  Hooks.on("canvasReady", onCanvasReady);
  Hooks.on("canvasTearDown", teardown);
  Hooks.on("updateScene", onUpdateScene);
  // the art grid follows the destruction layer's (its ap may arrive after the canvas is ready)
  Hooks.on("moinenMapsDestruction", (kind) => { if ( kind === "loaded" && strokes.size ) { const g = JSON.stringify(geo()); if ( display && JSON.stringify(display.geo) !== g ) { fields.clear(); draw(); } } });
  Hooks.on("moinenMapsPerfMode", () => display?.refresh());
  Hooks.once("ready", () => { const m = game.modules.get(MODULE_ID); if ( m ) { m.api ??= moduleApi; m.api.fire ??= fireApi; } });
}
