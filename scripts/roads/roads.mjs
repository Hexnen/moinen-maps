import { MODULE_ID } from "../config.mjs";
import { api as moduleApi } from "../attrs.mjs";
import * as Model from "./model.mjs";
import * as Graph from "./graph.mjs";
import { RoadDisplay } from "./display.mjs";
import { TrafficView } from "./cars.mjs";
import { TrafficSim, catchUp, fingerprint, EPOCH, DT } from "./traffic.mjs";
import { destroyTextures } from "./art.mjs";
import * as Editor from "./editor.mjs";
import { openRoadsPanel, mountRoadControls } from "./panel.mjs";
import { roadsSection } from "./section.mjs";

/**
 * Roads of the open scene: loads them from the scene flag, shows the baked roads and the traffic, takes the GM's edits (undo,
 * redo, a debounced save) and follows other clients' saves. Public API: `game.modules.get("moinen-maps").api.roads`.
 *
 * Hooks fired: "moinenMapsRoads" with ("loaded" | "edited" | "params" | "mode" | "brush").
 */

let R = null, display = null, traffic = null, saveTimer = 0;
let seen = { graph: "", look: "", sim: "", show: "" };
const undo = [], redo = [];
const UNDO_MAX = 60;
/** Settings that change what the simulation does (a new simulation); the rest only change how cars look. */
const SIM_KEYS = Model.SIM_KEYS;

export const tell = (kind) => Hooks.callAll("moinenMapsRoads", kind);
export const state = () => R;
export const gridSize = () => canvas.dimensions?.size ?? canvas.grid?.size ?? 100;
const sceneRect = () => canvas.dimensions?.sceneRect ?? { x: 0, y: 0, width: canvas.scene?.width ?? 0, height: canvas.scene?.height ?? 0 };

/* ---------------------------------------------------------------- settings */

function registerSettings() {
  const S = game.settings, f = () => tell("brush");
  S.register(MODULE_ID, "roadKind", { scope: "client", config: false, type: String, default: "asphalt", onChange: f });
  S.register(MODULE_ID, "roadWidth", { scope: "client", config: false, type: Number, default: 0.9, onChange: f });
  S.register(MODULE_ID, "roadLanes", { scope: "client", config: false, type: Number, default: 2, onChange: f });
  S.register(MODULE_ID, "roadOneway", { scope: "client", config: false, type: Boolean, default: false, onChange: f });
  S.register(MODULE_ID, "roadEraser", { scope: "client", config: false, type: Number, default: 0.6, onChange: f });
  // anyone may hide the cars on their own screen
  S.register(MODULE_ID, "roadTrafficLocal", { scope: "client", config: false, type: Boolean, default: true, onChange: () => { applyVisibility(); tell("params"); } });
}

export function brush() {
  const get = (k, d) => { try { return game.settings.get(MODULE_ID, k); } catch { return d; } };
  const k = get("roadKind", "asphalt");
  return {
    k: Model.KINDS.includes(k) ? k : "asphalt",
    w: Math.min(Model.LIMITS.width[1], Math.max(Model.LIMITS.width[0], Number(get("roadWidth", 0.9)) || 0.9)),
    l: Number(get("roadLanes", 2)) === 1 ? 1 : 2,
    o: get("roadOneway", false) ? 1 : 0,
    eraser: Math.min(4, Math.max(0.15, Number(get("roadEraser", 0.6)) || 0.6))
  };
}

export async function setBrush(patch) {
  const map = { k: "roadKind", w: "roadWidth", l: "roadLanes", o: "roadOneway", eraser: "roadEraser" };
  for ( const [key, v] of Object.entries(patch) ) if ( map[key] ) await game.settings.set(MODULE_ID, map[key], key === "o" ? !!v : v);
}

/* ---------------------------------------------------------------- lifecycle */

function onCanvasReady() {
  teardown();
  if ( !canvas.scene ) return;
  R = Model.load(canvas.scene);
  display = new RoadDisplay();
  traffic = new TrafficView();
  seen = { graph: "", look: "", sim: "", show: "" };
  apply();
  Editor.onCanvasReady();
  tell("loaded");
}

function teardown() {
  clearTimeout(saveTimer); saveTimer = 0;
  Editor.teardown();
  display?.destroy(); traffic?.destroy();
  display = traffic = null; R = null;
  undo.length = redo.length = 0;
}

function onUpdateScene(scene, changed, _options, userId) {
  if ( scene.id !== canvas.scene?.id || !R ) return;
  const f = changed.flags?.[MODULE_ID];
  if ( !f || !(Model.FLAG in f || `-=${Model.FLAG}` in f) ) return;
  if ( userId === game.user.id ) return;          // our own save: already shown
  R = Model.load(scene);
  apply();
  tell("loaded");
}

/** Show what changed since the last time: the baked roads, the traffic network, or only the cars' look. */
function apply() {
  if ( !R || !display || !traffic ) return;
  const enc = Model.encode(R);
  const graph = JSON.stringify([enc.n, enc.e]), look = JSON.stringify(enc.look);
  const sim = JSON.stringify(SIM_KEYS.map((k) => enc.traffic[k]));
  const g = gridSize();
  if ( graph !== seen.graph || look !== seen.look || previewing ) { previewing = false; display.render(Model.hasRoads(R) ? R : null, g); }
  if ( graph !== seen.graph || sim !== seen.sim ) traffic.configure(R, g, sceneRect(), canvas.scene.id);
  else traffic.restyle(R);
  seen = { ...seen, graph, look, sim };
  applyVisibility();
}

function applyVisibility() {
  if ( !traffic || !R ) return;
  let local = true;
  try { local = game.settings.get(MODULE_ID, "roadTrafficLocal"); } catch {}
  traffic.visible = R.traffic.on && local && (R.traffic.who === "all" || game.user.isGM);
}

/** Make the set exactly what every other client will decode from the flag (the traffic must start from identical numbers). */
function canonical(set) {
  return Model.load({ flags: { [MODULE_ID]: { [Model.FLAG]: JSON.parse(JSON.stringify(Model.encode(set))) } } });
}

/* ---------------------------------------------------------------- editing (GM) */

const graphSnapshot = () => { const e = Model.encode(R); return { n: e.n, e: e.e, next: e.next }; };

/**
 * Change the roads: `fn(G)` edits a copy of the graph and returns true when it changed something. One undo step.
 */
export function edit(fn) {
  if ( !game.user.isGM || !R ) return false;
  const before = graphSnapshot();
  const G = Graph.cloneGraph(R.G);
  if ( !fn(G) ) return false;
  undo.push(before); if ( undo.length > UNDO_MAX ) undo.shift();
  redo.length = 0;
  R = canonical({ ...R, G });
  apply(); scheduleSave(); tell("edited");
  return true;
}

let previewing = false;
/** Show the roads of graph G (an edit being dragged) without keeping them; null goes back to the real roads. */
export function previewGraph(G) {
  if ( !display || !R ) return;
  if ( G ) { previewing = true; display.render({ ...R, G }, gridSize()); }
  else if ( previewing ) { previewing = false; display.render(Model.hasRoads(R) ? R : null, gridSize()); }
}

function restoreGraph(snap) {
  const enc = Model.encode(R);
  R = Model.load({ flags: { [MODULE_ID]: { [Model.FLAG]: { ...enc, n: snap.n, e: snap.e, next: snap.next } } } });
  apply(); scheduleSave(); tell("edited");
}

export function undoEdit() { const s = undo.pop(); if ( !s || !R ) return false; redo.push(graphSnapshot()); restoreGraph(s); return true; }
export function redoEdit() { const s = redo.pop(); if ( !s || !R ) return false; undo.push(graphSnapshot()); restoreGraph(s); return true; }
export const canUndo = () => undo.length > 0;
export const canRedo = () => redo.length > 0;

export function setTraffic(patch) {
  if ( !game.user.isGM || !R ) return;
  const traffic = Model.cleanTraffic({ ...R.traffic, ...patch });
  if ( foundry.utils.equals(traffic, R.traffic) ) return;     // nothing changed: no new simulation, no save
  R = canonical({ ...R, traffic });
  apply(); scheduleSave(); tell("params");
}

export function setLook(patch) {
  if ( !game.user.isGM || !R ) return;
  const look = Model.cleanLook({ ...R.look, ...patch });
  if ( foundry.utils.equals(look, R.look) ) return;
  R = canonical({ ...R, look });
  apply(); scheduleSave(); tell("params");
}

/** Change one road's kind, width, lanes, one-way or speed (patch of { k, w, l, o, sp }). Keeps its id. */
export function setRoad(id, patch) {
  return edit((G) => {
    const e = G.edges.get(id); if ( !e ) return false;
    const next = {
      k: Model.KINDS.includes(patch.k) ? patch.k : e.k,
      w: patch.w != null ? Math.min(Model.LIMITS.width[1], Math.max(Model.LIMITS.width[0], Number(patch.w) || e.w)) : e.w,
      l: patch.l != null ? (Number(patch.l) === 1 ? 1 : 2) : e.l,
      o: patch.o != null ? (patch.o ? 1 : 0) : e.o,
      sp: patch.sp != null ? Math.min(Model.LIMITS.roadSpeed[1], Math.max(Model.LIMITS.roadSpeed[0], Number(patch.sp) || 1)) : (e.sp ?? 1)
    };
    if ( next.k === e.k && next.w === e.w && next.l === e.l && next.o === e.o && next.sp === (e.sp ?? 1) ) return false;
    Object.assign(e, next);
    return true;
  });
}

export const shuffleTraffic =() => setTraffic({ seed: Math.floor(Math.random() * 999998) + 1 });
export const clearRoads = () => edit((G) => { if ( !G.edges.size ) return false; G.edges.clear(); G.nodes.clear(); return true; });

function scheduleSave(ms = 500) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = 0; save(); }, ms);
}

export async function save() {
  if ( !game.user.isGM || !R || !canvas.scene ) return;
  await canvas.scene.update({ [`flags.${MODULE_ID}.${Model.FLAG}`]: Model.encode(R) });
}

/* ---------------------------------------------------------------- facts for panels */

export function stats() {
  if ( !R ) return { roads: 0, junctions: 0, cars: 0, visible: 0 };
  let junctions = 0;
  for ( const n of R.G.nodes.values() ) if ( Graph.degree(R.G, n.id) >= 3 ) junctions++;
  return { roads: R.G.edges.size, junctions, cars: traffic?.stats.cars ?? 0, visible: traffic?.stats.visible ?? 0, frameMs: traffic?.stats.frameMs ?? 0, bake: display?.lastBake ?? null };
}

/* ---------------------------------------------------------------- public API */

export const roadsApi = {
  /** Tools a host (the workspace menu) can show: `mode` ones switch the canvas tool, `button` ones run once. */
  tools: [
    { id: "draw", mode: "draw", icon: "fa-solid fa-road", title: "MOINENMAPS.Roads.tool.draw" },
    { id: "erase", mode: "erase", icon: "fa-solid fa-eraser", title: "MOINENMAPS.Roads.tool.erase" },
    { id: "edit", mode: "edit", icon: "fa-solid fa-bezier-curve", title: "MOINENMAPS.Roads.tool.edit" },
    { id: "settings", button: true, icon: "fa-solid fa-car-side", title: "MOINENMAPS.Roads.tool.settings", run: () => openRoadsPanel() }
  ],
  /** Sections of controls a host can mount in its own panels: "brush" (an options bar), "traffic" and "look" (dock panels). */
  sections: ["bar", "brush", "traffic", "look"],
  /** The whole workspace section (scripts/workspace/registry.mjs shape): registerSection(api.roads.section()). */
  section: () => roadsSection(),
  /** Switch the GM's road tool on ("draw" | "erase" | "edit") or off (null). */
  activate: (mode = "draw") => Editor.setMode(mode),
  deactivate: () => Editor.setMode(null),
  mode: () => Editor.mode(),
  /** Open the roads window (brush, traffic and look). */
  openSettings: () => openRoadsPanel(),
  /** Render one or more sections into a host element; returns { refresh(), destroy() }. */
  mount: (host, sections) => mountRoadControls(host, sections),
  brush, setBrush, setRoad,
  /** The road selected with the edit tool (an edge id), or null. */
  selected: () => Editor.selectedEdge(),
  undo: undoEdit, redo: redoEdit, clear: clearRoads,
  setTraffic, setLook, shuffle: shuffleTraffic,
  state: () => R ? Model.encode(R) : null,
  stats,
  /** Where every car is drawn right now. */
  cars: () => traffic?.snapshot() ?? [],
  /** Determinism check: a fresh simulation of this scene stepped to (epoch, step), as a fingerprint. Same on every client. */
  replay(epoch, step) {
    if ( !traffic?.net || !R ) return null;
    const sim = new TrafficSim(traffic.net, R.traffic, canvas.scene.id, epoch);
    catchUp(sim, step, 1e9);
    return { epoch, step, fp: fingerprint(sim), first: sim.cars.slice(0, 3).map((c) => ({ id: c.id, piece: c.piece, s: c.s })) };
  },
  /** Debugging: the traffic view (sprites, simulation) of this client. */
  _view: () => traffic,
  /** The live simulation's clock: { epoch, step }. */
  clock: () => traffic?.sim ? { epoch: traffic.sim.epoch, step: traffic.sim.step, ready: !!traffic.sim.ready, EPOCH, DT } : null
};

export function registerRoads() {
  moduleApi.roads = roadsApi;
  Hooks.once("init", registerSettings);
  Hooks.on("canvasReady", onCanvasReady);
  Hooks.on("canvasTearDown", teardown);
  Hooks.on("updateScene", onUpdateScene);
  Hooks.on("canvasPan", () => Editor.onPan());
  Hooks.once("ready", () => { const m = game.modules.get(MODULE_ID); if ( m ) { m.api ??= moduleApi; m.api.roads ??= roadsApi; } });
  // textures of the cars belong to the renderer: free them when the page goes
  window.addEventListener("beforeunload", () => destroyTextures());
}
