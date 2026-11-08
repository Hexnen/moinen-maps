import { MODULE_ID, reducedMotion } from "../config.mjs";
import { api as moduleApi } from "../attrs.mjs";
import * as M from "./model.mjs";
import { WeatherDisplay } from "./display.mjs";
import { buildInfo, buildShelter, shelterShapes, layoutOf } from "./sources.mjs";
import { sharedNow } from "../shared-clock.mjs";
import { perfMode } from "../perf-mode.mjs";
import * as DModel from "../destruction/model.mjs";
import * as D from "../destruction/destruction.mjs";
import { view as viewOf, VIEW_FLAG, cleanView } from "../view-angle.mjs";
import { setWindProvider, windVecAt, SPEED_SQ } from "../wind.mjs";

/**
 * WEATHER, the engine: the scene's weather flag (model.mjs), the display (display.mjs) and the lens (lens.mjs), the GM's changes
 * (each one a key on the timeline: one scene write, then every client ramps on its own from the shared clock), the client's caps.
 * Public API: `game.modules.get("moinen-maps").api.weather`. Hook fired: "moinenMapsWeather" ("loaded" | "changed" | "state").
 *
 * COST WHEN OFF: no display object, no ticker, no texture: only these hooks. A future key (a change scheduled ahead) is one timer.
 */
let P = M.cleanParams();
let display = null, lens = null;
let info = null, shelter = null, infoKey = "", shelterKey = "", infoJob = 0;
let timer = 0, shelterTimer = 0;
let lastState = null;

export const tell = (kind) => Hooks.callAll("moinenMapsWeather", kind);
export const params0 = () => P;

/** The art grid (the destruction layer's, as fire's): { ap, ox, oy, grid, aw, ah }. */
export function geo() {
  const r = DModel.sceneRect(), ap = D.state()?.ap ?? DModel.artPx(), grid = canvas.grid?.size ?? 100;
  return { ap, ox: r.x, oy: r.y, grid, aw: Math.max(1, Math.ceil(r.width / ap)), ah: Math.max(1, Math.ceil(r.height / ap)) };
}

/* ---------------------------------------------------------------- the client's caps */

const setting = (k, d) => { try { return game.settings.get(MODULE_ID, k); } catch { return d; } };
/** The highest world level this client draws (0 = off): its own setting, Performance Low caps at 2. */
export function detailCap() {
  const s = setting("weatherDetail", "3"); if ( s === "off" ) return 0;
  const c = Math.max(1, Math.min(3, Number(s) || 3));
  return perfMode() === "low" ? Math.min(c, 2) : c;
}
/** The highest lens level this client draws (0 = none): its setting; none in Performance Low or with reduced motion. */
export function lensCap() {
  const s = setting("weatherLens", "3"); if ( s === "off" || perfMode() === "low" || reducedMotion() ) return 0;
  return Math.max(1, Math.min(3, Number(s) || 3));
}
const shown = () => P.on && (P.who !== "gm" || game.user.isGM) && detailCap() > 0;

/** The resolved state for this client: levels capped, densities scaled by performance / reduced motion, the view. */
function clientState(now = sharedNow()) {
  const st = M.resolve(P, now), cap = detailCap();
  const fx = {};
  for ( const [e, f] of Object.entries(st.fx) ) fx[e] = { p: f.p, s: Math.min(f.s, cap - 1 + 0.35) };
  const pm = perfMode(), still = reducedMotion();
  const perf = (pm === "low" ? 0.3 : pm === "medium" ? 0.6 : 1) * (still ? 0.5 : 1);
  return { ...st, fx, perf, noNear: pm !== "high", sheen: pm !== "low", puddles: P.ground.puddles, view: viewOf(), seed: P.seed, lensCap: lensCap() };
}

/* ---------------------------------------------------------------- load / follow */

function load(scene = canvas.scene) {
  P = M.cleanParams(scene?.flags?.[MODULE_ID]?.[M.FLAG]);
}

function onCanvasReady() {
  teardown();
  if ( !canvas.scene ) return;
  load();
  refresh();
  tell("loaded");
}

export function teardown() {
  clearTimeout(timer); timer = 0; clearTimeout(shelterTimer); shelterTimer = 0;
  cancelIdle();
  display?.destroy(); display = null;
  lens?.destroy?.(); lens = null;
  info?.texture?.destroy(true); info = null; infoKey = "";
  shelter?.texture?.destroy(true); shelter = null; shelterKey = "";
  lastState = null;
}

function onUpdateScene(scene, changed) {
  if ( scene.id !== canvas.scene?.id ) return;
  const f = changed?.flags?.[MODULE_ID]; if ( !f ) return;
  if ( ![M.FLAG, `-=${M.FLAG}`, VIEW_FLAG, `-=${VIEW_FLAG}`].some((k) => k in f) ) return;
  load(scene);
  refresh();
  tell("changed");
}

/**
 * Show what the flag says now: make or drop the display, (re)build its sources, hand it the state. With nothing to show the display
 * is destroyed; a key that starts later is one timer.
 */
export function refresh() {
  clearTimeout(timer); timer = 0;
  if ( !canvas.ready || !canvas.scene ) return;
  const now = sharedNow(), st = shown() ? clientState(now) : null;
  const live = !!st && (Object.keys(st.fx).length > 0 || st.wet > 0.002 || st.cover > 0.002);
  lastState = st;
  if ( !live ) {
    if ( display ) { display.destroy(); display = null; }
    if ( lens ) { lens.destroy(); lens = null; }
    const next = P.keys.find((k) => k.t > now);
    if ( next && shown() ) timer = setTimeout(() => { timer = 0; refresh(); }, Math.min(2 ** 31 - 1, Math.max(16, next.t - now + 20)));
    return;
  }
  const g = geo();
  display ??= new WeatherDisplay();
  display.now = sharedNow;
  display.build(g, P.seed);
  sources(g);
  display.setSources(info, shelter);
  display.onStep = () => step();
  display.setState(st);
  syncLens(st);
}

/** At most 12 times a second (the display's ticker): the state moves along the timeline. */
function step() {
  if ( !display ) return;
  const st = clientState();
  lastState = st;
  if ( !Object.keys(st.fx).length && st.wet <= 0.002 && st.cover <= 0.002 && st.steady ) { refresh(); return; }
  display.setState(st);
  syncLens(st);
  const s1 = Math.floor(Date.now() / 1000);
  if ( s1 !== stateTold ) { stateTold = s1; tell("state"); }   // (the dock's status line, once a second)
}
let stateTold = 0;

/* ---------------------------------------------------------------- the lens (on-glass effects) */

let LensClass = null;
/** Lazily loaded (lens.mjs): a client without lens effects never loads its shaders. */
async function lensClass() { return LensClass ??= (await import("./lens.mjs")).WeatherLens; }
function syncLens(st) {
  const want = !!st && P.lens.on && st.lensCap > 0 && Object.keys(st.fx).some((e) => M.TABLES[e]?.lens && (e !== "embers" || P.lens.heat));
  if ( !want ) { if ( lens ) { lens.destroy(); lens = null; } return; }
  if ( !lens ) {
    if ( lens === null && !LensClass ) { lens = false; lensClass().then(() => { lens = null; if ( display ) syncLens(lastState); }); return; }
    if ( lens === false ) return;
    lens = new LensClass();
    lens.now = sharedNow;
  }
  lens.setState(st, P);
}

/* ---------------------------------------------------------------- sources (ground info, shelter) */

let idleId = 0;
function cancelIdle() { if ( idleId ) { (globalThis.cancelIdleCallback ?? clearTimeout)(idleId); idleId = 0; } }
function sources(g) {
  const L = layoutOf(g.aw, g.ah);
  const bg = canvas.primary?.background?.texture?.baseTexture?.cacheId ?? canvas.scene?.background?.src ?? "";
  const ik = `${canvas.scene.id}|${bg}|${g.ap}|${g.aw}x${g.ah}`;
  if ( ik !== infoKey && !idleId ) {
    const job = ++infoJob;
    const run = () => {
      idleId = 0;
      if ( job !== infoJob || !display ) return;
      try { const I = buildInfo(g); info?.texture?.destroy(true); info = I; infoKey = ik; display?.setSources(info, shelter); lens?.setInfo?.(info); }
      catch ( err ) { console.warn(`${MODULE_ID} | weather: ground info`, err); infoKey = ik; }
    };
    idleId = globalThis.requestIdleCallback ? requestIdleCallback(run, { timeout: 1500 }) : setTimeout(run, 50);
  }
  const shapes = shelterShapes(), sk = JSON.stringify([ik, shapes]);
  if ( sk !== shelterKey ) {
    shelterKey = sk;
    shelter?.texture?.destroy(true);
    try { shelter = buildShelter(g, L, shapes); } catch ( err ) { console.warn(`${MODULE_ID} | weather: shelter`, err); shelter = null; }
  }
}
/** Tiles or regions changed: the shelter is rebuilt (debounced), only while there is weather. */
function shelterSoon() {
  if ( !display ) return;
  clearTimeout(shelterTimer);
  shelterTimer = setTimeout(() => { shelterTimer = 0; if ( display ) { sources(geo()); display.setSources(info, shelter); } }, 250);
}

/* ---------------------------------------------------------------- edits (GM) */

async function write(upd) {
  if ( !game.user.isGM || !canvas.scene ) return false;
  try { await canvas.scene.update(upd); return true; } catch ( err ) { console.warn(`${MODULE_ID} | weather: could not save`, err); return false; }
}
const flagKey = `flags.${MODULE_ID}.${M.FLAG}`;
function save() { return write({ [flagKey]: { ...P, v: M.VERSION } }); }

/**
 * A CHANGE on the timeline (GM): `change` = { preset?, level?, i?, fx?, wind? }; `over` ms (the transition), `at` shared ms (default
 * now + the lead). One scene write; every client ramps from the shared clock.
 */
export function change(chg, { over = M.DEFAULT_DUR, at = null } = {}) {
  if ( !game.user.isGM || !canvas.scene ) return null;
  const now = at ?? sharedNow();
  const { keys, base } = M.withKey(P, chg, now, { dur: Math.max(0, Number(over) || 0), lead: at === null ? M.LEAD_MS : 0 });
  P = M.cleanParams({ ...P, keys, base });
  refresh(); tell("changed");
  save();
  return M.current(P);
}

/** Dry the ground now (GM): the newest started key stays (a running change goes on); the wetness starts again from 0. */
export function dryNow() {
  if ( !game.user.isGM || !canvas.scene ) return;
  const now = Math.round(sharedNow());
  const started = P.keys.filter((k) => k.t <= now), later = P.keys.filter((k) => k.t > now), keep = started[started.length - 1];
  const from = keep ? M.stateAt(P, keep.t) : M.stateAt(P, now);
  P = M.cleanParams({ ...P, keys: [...(keep ? [keep] : []), ...later], base: { t: now, fx: from.fx, wind: from.wind, wet: 0, cover: 0 } });
  refresh(); tell("changed");
  save();
}

/** Layer settings (GM): { on, who, ground: {...}, lens: {...}, seed }. */
export function setParams(patch) {
  if ( !game.user.isGM ) return;
  P = M.cleanParams({ ...P, ...patch, ground: { ...P.ground, ...(patch.ground ?? {}) }, lens: { ...P.lens, ...(patch.lens ?? {}) } });
  refresh(); tell("params");
  save();
}

/** The scene's view angle (shared with fire): a preset name or { lift, squash }. */
export function setView(v) {
  if ( !game.user.isGM || !canvas.scene ) return;
  const cv = cleanView(typeof v === "string" ? { preset: v } : v);
  write({ [`flags.${MODULE_ID}.${VIEW_FLAG}`]: { lift: cv.lift, squash: cv.squash } });
}

/* ---------------------------------------------------------------- the api */

const lvlOf = (n) => { const v = Math.round(Number(n)); return v >= 1 && v <= 3 ? v : null; };
export const weatherApi = {
  /** The resolved state now (or at shared ms `t`): { fx: { eff: { p, s } }, wind, wet, steady, until, key }. */
  state: (t) => M.resolve(P, t ?? sharedNow()),
  /** Change the weather: a preset name ("clear", "rain", ...) or { preset?, fx?, wind? }; { level 1..3, i 0..1, over ms, at shared ms }. */
  set(what, { level, i, over = M.DEFAULT_DUR, at = null } = {}) {
    const c = typeof what === "string" ? { preset: what } : { ...(what ?? {}) };
    if ( level !== undefined ) c.level = lvlOf(level) ?? 2;
    if ( i !== undefined ) c.i = Math.min(1, Math.max(0, Number(i) || 0));
    if ( c.fx && !c.preset ) c.preset = "custom";
    return change(c, { over, at });
  },
  /** Change only the level (and fine intensity) of the current preset: level(n, { i, over }). */
  level(n, { i, over = M.DEFAULT_DUR } = {}) { const c = { level: lvlOf(n) ?? 2 }; if ( i !== undefined ) c.i = Number(i); return change(c, { over }); },
  /** The scene wind: { dir (deg, 0 = right, 90 = down), str 0..1, gust 0..1 }, { over ms }. */
  wind(w, { over = 5000 } = {}) { return change({ wind: w }, { over }); },
  /** Lens effects (scene default): { on, level: "auto" | 1..3, strength 0..1 }. */
  lens(l = {}) { setParams({ lens: l }); return { ...P.lens }; },
  clear({ over = M.DEFAULT_DUR } = {}) { return change({ preset: "clear" }, { over }); },
  presets: () => Object.keys(M.PRESETS),
  levels: (preset) => M.levels(preset),
  params: () => foundry.utils.deepClone(P), setParams, setView, view: () => viewOf(),
  /** The wind at a scene point now: { x, y } in squares per second, g the gust value. */
  windAt(x, y) {
    const st = M.resolve(P, sharedNow()), g = canvas.grid?.size ?? 100;
    const v = windVecAt(st.wind, x / g, y / g, (sharedNow() / 1000) % 3600, P.seed);
    return { x: v.x * SPEED_SQ, y: v.y * SPEED_SQ, g: v.g };
  },
  /** How much it rains at a point now (0..~1.35; 0 under a roof is not checked here), for other layers (fire). */
  rainAt() { const r = M.resolve(P, sharedNow()).fx.rain; return r ? r.p * M.gate([0.35, 0.7, 1], r.s) : 0; },
  /** How it stands on this client: what is drawn, instances, last tick ms, lens. */
  status: () => ({ on: P.on, who: P.who, shown: shown(), display: !!display, ticking: !!display?.ticking, lens: !!lens, detail: detailCap(), lensCap: lensCap(),
    info: !!info, shelter: !!shelter, ...(display?.stats ?? {}), lensStats: lens?.stats ?? null, state: lastState }),
  display: () => display, lensDisplay: () => lens, refresh, model: M, geo
};

/* ---------------------------------------------------------------- wiring */

export function registerWeatherSettings() {
  const ch = (k) => ({ off: `MOINENMAPS.Weather.cap.off`, 1: `MOINENMAPS.Weather.cap.1`, 2: `MOINENMAPS.Weather.cap.2`, 3: `MOINENMAPS.Weather.cap.3` });
  game.settings.register(MODULE_ID, "weatherDetail", { name: "MOINENMAPS.Weather.set.detail", hint: "MOINENMAPS.Weather.set.detailHint", scope: "client", config: true, type: String, default: "3", choices: ch(), onChange: () => { refresh(); tell("client"); } });
  game.settings.register(MODULE_ID, "weatherLens", { name: "MOINENMAPS.Weather.set.lens", hint: "MOINENMAPS.Weather.set.lensHint", scope: "client", config: true, type: String, default: "3", choices: ch(), onChange: () => { refresh(); tell("client"); } });
  // the GM's last transition time (s) in the bar
  game.settings.register(MODULE_ID, "weatherOver", { scope: "client", config: false, type: Number, default: 20 });
}

export function registerWeather() {
  moduleApi.weather = weatherApi;
  setWindProvider(() => (P.on && canvas.scene ? M.resolve(P, sharedNow()).wind : null));
  Hooks.once("init", registerWeatherSettings);
  Hooks.on("canvasReady", onCanvasReady);
  Hooks.on("canvasTearDown", teardown);
  Hooks.on("updateScene", onUpdateScene);
  Hooks.on("moinenMapsPerfMode", () => refresh());
  Hooks.on("moinenMapsDestruction", (kind) => { if ( kind === "loaded" && display ) refresh(); });
  for ( const h of ["createTile", "updateTile", "deleteTile", "createRegion", "updateRegion", "deleteRegion", "createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior"] ) Hooks.on(h, shelterSoon);
  Hooks.once("ready", () => { const m = game.modules.get(MODULE_ID); if ( m ) { m.api ??= moduleApi; m.api.weather ??= weatherApi; } });
}
