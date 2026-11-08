import { MODULE_ID } from "../config.mjs";
import { api as moduleApi } from "../attrs.mjs";
import * as M from "./model.mjs";
import * as Look from "./look.mjs";
import { FireDisplay } from "./display.mjs";
import { sharedNow } from "../shared-clock.mjs";
import * as DModel from "../destruction/model.mjs";
import * as D from "../destruction/destruction.mjs";
import { reducedMotion } from "../config.mjs";

/**
 * FIRE AND SMOKE, the engine: the strokes of the open scene (scene flags, model.mjs), the display (display.mjs), the GM's edits
 * (each stroke one flag key; undo / redo of whole strokes; a clear), other clients' saves followed. Nothing is baked, published or
 * uploaded: every client computes the same areas and fields from the same strokes, and the same frame from the shared clock.
 * The fields are computed in a worker (raster-worker.mjs; the main thread only lays out the areas): an area whose new field is not
 * ready yet keeps showing the previous one of the same place, so painting, releasing, undo / redo and remote strokes never stall.
 * Public API: `game.modules.get("moinen-maps").api.fire`. Hook fired: "moinenMapsFire" ("loaded" | "edited" | "params" | "brush").
 */
let strokes = new Map();            // id -> stroke (stored)
let params = M.cleanParams();
let draft = null;                   // the stroke being painted (not stored yet)
let display = null;
let fields = new Map();             // area key -> field (cache: an unchanged area is not rasterized again)
let lastAreas = [];
let lastItems = [];                 // what the display shows now: { area, field } (a new area waits on one of these: no blank frame)
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
  fields.clear(); lastAreas = []; lastItems = []; draft = null; ready.clear(); queued.clear(); inflight.clear();
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

/* ---------------------------------------------------------------- the field worker */

// An area's field is computed in a worker (raster-worker.mjs; ~20-150 ms for a big area, more with torn edges): at most one job per
// area in flight, a newer request for the same area replaces the queued one (painting asks ~12 times a second), and a finished field
// waits in `ready` until the next draw adopts it. Without a worker (it failed to start) the field is computed here, as before.
// (localStorage "mm-fire-worker" = "off": fields on the main thread, for comparing / debugging)
let worker = null, workerOff = (() => { try { return globalThis.localStorage?.getItem("mm-fire-worker") === "off"; } catch { return false; } })();
const ready = new Map(), queued = new Map(), inflight = new Map();   // key -> field; area id -> job; area id -> key
const failed = new Set();           // keys the worker could not do (computed here then)
const route = () => new URL("./raster-worker.mjs", import.meta.url);
function startWorker() {
  if ( worker || workerOff ) return !!worker;
  try {
    worker = new Worker(route(), { type: "module" });
    worker.onmessage = (ev) => {
      const { key, field, err } = ev.data;
      for ( const [id, k] of inflight ) if ( k === key ) { inflight.delete(id); next(id); }
      if ( field ) ready.set(key, field); else { failed.add(key); console.warn(`${MODULE_ID} | fire: field worker`, err); }
      scheduleDraw();
    };
    worker.onerror = (e) => { console.warn(`${MODULE_ID} | fire: field worker off, fields on the main thread`, e?.message ?? e); stopWorker(true); scheduleDraw(); };
  } catch { workerOff = true; worker = null; }
  return !!worker;
}
function stopWorker(off = false) { worker?.terminate(); worker = null; workerOff ||= off; queued.clear(); inflight.clear(); }
function next(id) {
  const job = queued.get(id); if ( !job ) return;
  queued.delete(id); inflight.set(id, job.key);
  worker.postMessage(job);
}
/** Ask for an area's field; false when there is no worker (the caller rasterizes it itself). */
function request(a, g) {
  if ( !startWorker() ) return false;
  if ( [...inflight.values()].includes(a.key) ) return true;
  queued.set(a.id, { key: a.key, area: a, geo: g, P: params });
  if ( !inflight.has(a.id) ) next(a.id);
  return true;
}
const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

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
  if ( !has ) { if ( display ) { display.destroy(); display = null; } lastAreas = []; lastItems = []; fields.clear(); ready.clear(); return; }
  const keep = new Map(), items = [], used = new Set();
  const waiting = [];
  for ( const a of areas ) {
    let f = fields.get(a.key) ?? ready.get(a.key);
    if ( !f && (failed.has(a.key) || !request(a, g)) ) f = M.raster(a, g, params);
    if ( f ) { keep.set(a.key, f); items.push({ area: a, field: f }); } else waiting.push(a);
  }
  // an area whose field is still being computed shows what was there before (the previous field of the same place) meanwhile
  const shownIds = new Set(items.map((it) => it.area.id));
  for ( const a of waiting ) {
    let best = null, bo = 0;
    for ( const it of lastItems ) {
      if ( used.has(it) || shownIds.has(it.area.id) || it.area.id?.startsWith?.("x:") ) continue;
      const o = it.area.id === a.id ? Infinity : overlap(it.area.rect, a.rect);
      if ( o > bo ) { bo = o; best = it; }
    }
    if ( best ) { used.add(best); shownIds.add(best.area.id); items.push(best); }
  }
  for ( const k of ready.keys() ) if ( !keep.has(k) ) ready.delete(k);
  for ( const k of keep.keys() ) ready.delete(k);
  lastItems = items.slice();
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

/**
 * A NEW stroke's footprint: an organic edge (e = 1) and, while the scene's torn edges are on, its tearing (tn) - pinned on the stroke
 * when it is painted (changing the scene's setting later changes only the strokes painted from then on, as destruction's torn borders).
 * `raw.tn` given (a macro): that, 0 = not torn.
 */
function fresh(raw) {
  if ( raw.k === "erase" ) return raw;
  const tn = raw.tn !== undefined ? Number(raw.tn) || 0 : params.torn ? params.tear : 0;
  const { tn: _t, ...rest } = raw;
  return { e: 1, ...rest, ...(tn > 0 ? { tn } : {}) };
}

/** The stroke being painted (the editor): shown at once, stored on `commit`. null clears it. */
let draftAt = 0, draftTimer = 0;
export function setDraft(st) {
  draft = st ? M.cleanStroke({ ...fresh(st), id: "draft", q: st.q ?? sharedNow() }) : null;
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
  const st = M.cleanStroke({ ...fresh(raw), q: raw.q ?? sharedNow(), id: raw.id && raw.id !== "draft" ? raw.id : newId() });
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
  // (a scene update MERGES the stored object: the out time is deleted explicitly, or every other client would still see it out)
  for ( const s of list ) { const { o, ...rest } = s; const st = M.cleanStroke({ ...rest, g: now }); strokes.set(st.id, st); upd[sKey(st.id)] = st; upd[`${sKey(st.id)}.-=o`] = null; }
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

/** Torn edges on (amount 0.1..1; true = the scene's tearing) or off (0 / false) for one stroke afterwards: one write, drawn again. */
export function setTorn(id, amount) {
  const s = strokes.get(id); if ( !s || s.k === "erase" || !game.user.isGM || s.o !== undefined ) return null;
  const tn = amount === true ? params.tear : Number(amount) || 0;
  const { tn: _t, ...rest } = s;
  const st = M.cleanStroke(tn > 0 ? { ...rest, tn } : rest);
  strokes.set(id, st); draw(); tell("edited");
  write({ [sKey(id)]: st, ...(st.tn ? {} : { [`${sKey(id)}.-=tn`]: null }) });
  return st;
}

/** Change a stroke's fire colour afterwards ("#rrggbb", a preset name; null / "" = the scene's): one write, drawn again. */
export function setColor(id, color) {
  const s = strokes.get(id); if ( !s || s.k === "erase" || !game.user.isGM || s.o !== undefined ) return null;
  const { c, ...rest } = s;
  const st = M.cleanStroke(color ? { ...rest, c: color } : rest);
  strokes.set(id, st); draw(); tell("edited");
  write({ [sKey(id)]: st, ...(st.c ? {} : { [`${sKey(id)}.-=c`]: null }) });   // (an update merges: back to the scene's colour = delete c)
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
   * px; `strength` 0.1..1; `wind` { dir (degrees, 0 = right, 90 = down), speed 0..1 }; `level` 1..3 (fire), `smoke` 0..3 (fire) /
   * 1..3 (smoke); `style` "fire" | "fireball"; `color` "#rrggbb" or a preset name (look.PRESETS; omitted: the scene's fire colour).
   * `torn`: true / an amount 0.1..1 / false (omitted: the scene's torn edges). Returns the stored stroke (or null).
   */
  paint(points, { kind = "fire", radius = 50, strength = 0.8, wind = null, level = 2, smoke = 2, style = "fire", color = null, torn = undefined } = {}) {
    const pts = Array.isArray(points) ? points : [[points.x, points.y]];
    const w = wind ?? { dir: game.settings.get(MODULE_ID, "fireWindDir"), speed: game.settings.get(MODULE_ID, "fireWind") };
    return add({ k: kind, r: radius, s: strength, p: pts.flatMap(([x, y]) => [x, y]), wd: w.dir ?? 0, ws: w.speed ?? 0, lv: level, sm: smoke, st: style, ...(color ? { c: color } : {}),
      ...(torn === undefined ? {} : { tn: torn === true ? params.tear : Number(torn) || 0 }) });
  },
  /** Torn edges for one stroke afterwards: true (the scene's tearing), an amount 0.1..1, or false. */
  setTorn: (id, amount) => setTorn(id, amount),
  /** Change a stroke's levels afterwards: `{ level, smoke }`. */
  setLevels: (id, { level, smoke } = {}) => setLevels(id, { lv: level, sm: smoke }),
  /** Change a stroke's fire colour afterwards ("#rrggbb", a preset name; null = the scene's). */
  setColor: (id, color) => setColor(id, color),
  /** The colour presets and the palette rule (look.mjs). */
  colors: () => ({ ...Look.PRESETS }), rampOf: (c) => Look.rampOf(c),
  erase(x, y, radius = 50) { return add({ k: "erase", r: radius, s: 1, p: [x, y] }); },
  remove: (id) => remove(id), clear, undo, redo,
  list: () => list().map((s) => ({ ...s, p: [...s.p] })),
  params: () => ({ ...params }), setParams,
  /** How it stands: strokes, areas, what is drawn, particles, lights, the last tick's ms. */
  status: () => ({ pending: inflight.size + queued.size, strokes: strokes.size, out: [...strokes.values()].filter((s) => s.o !== undefined).length, animating: lastAreas.filter((a) => Object.values(a.phases ?? {}).some((p) => p !== "on")).length, areas: lastAreas.length, shown: shown(), on: params.on, who: params.who, ...(display?.stats ?? { visible: 0, particles: 0, lights: 0, tickMs: 0 }), display: !!display }),
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
  // (a token moved, appeared, went or changed size: its depth against the flames, recomputed once on the next frame)
  for ( const h of ["refreshToken", "createToken", "deleteToken"] ) Hooks.on(h, () => display?.tokensDirty());
  Hooks.once("ready", () => { const m = game.modules.get(MODULE_ID); if ( m ) { m.api ??= moduleApi; m.api.fire ??= fireApi; } });
}
