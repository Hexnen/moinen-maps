import { MODULE_ID, reducedMotion } from "../config.mjs";
import { api as moduleApi } from "../attrs.mjs";
import * as M from "./model.mjs";
import { WeatherDisplay, displayPrograms } from "./display.mjs";
import { buildInfo, buildShelter, shelterShapes, layoutOf } from "./sources.mjs";
import { sharedNow } from "../shared-clock.mjs";
import { perfMode } from "../perf-mode.mjs";
import * as DModel from "../destruction/model.mjs";
import * as D from "../destruction/destruction.mjs";
import { view as viewOf, VIEW_FLAG, cleanView } from "../view-angle.mjs";
import { setWindProvider, setVortexProvider, setFireWetProvider, windVecAt, SPEED_SQ } from "../wind.mjs";
import * as TM from "./tornado-model.mjs";
import { TornadoDisplay, tornadoPrograms } from "./tornado.mjs";
import { SteamLayer } from "./steam.mjs";
import { guardInfo } from "./guard.mjs";
import { warmPrograms } from "../gl-warm.mjs";
import { CloudDisplay, cloudPrograms } from "./clouds.mjs";

/**
 * WEATHER, the engine: the scene's weather flag (model.mjs), the display (display.mjs) and the lens (lens.mjs), the GM's changes
 * (each one a key on the timeline: one scene write, then every client ramps on its own from the shared clock), the client's caps.
 * Public API: `game.modules.get("moinen-maps").api.weather`. Hook fired: "moinenMapsWeather" ("loaded" | "changed" | "state").
 *
 * COST WHEN OFF: no display object, no ticker, no texture: only these hooks. A future key (a change scheduled ahead) is one timer.
 */
let P = M.cleanParams();
let display = null, lens = null, tornado = null, tornadoTimer = 0, steam = null, clouds = null;
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
  prewarm();
  tell("loaded");
}

/**
 * PRE-WARM: the weather's shader programs compiled in the background after the scene loads, so the frame a weather starts does not
 * compile up to a dozen of them at once (the cold-start hitch: on a GPU process whose program cache misses, one link is 0.3-4 s of
 * blocked main thread). With KHR_parallel_shader_compile each program is first compiled and linked off the main thread, exactly as
 * PIXI will (the same sources, the same link, the same sorted attribute bindings and relink), polled once a frame; the browser's
 * program cache then holds it, and PIXI's own compile of it, one per frame, is a cache hit of a few ms. Without the extension: one
 * plain PIXI compile per idle callback (the shared scripts/gl-warm.mjs). Programs already compiled are skipped;
 * `CONFIG.moinenMaps.weatherPrewarm = false` turns it off. Only where the weather can show for this client; the lens's only where
 * the scene's lens is on.
 */
let warmJob = 0;
async function prewarm() {
  const job = ++warmJob;
  if ( globalThis.CONFIG?.moinenMaps?.weatherPrewarm === false || !shown() ) return;
  const list = [...displayPrograms(), ...cloudPrograms(), ...tornadoPrograms()];
  if ( P.lens?.on ) try { list.push(...(await import("./lens.mjs")).lensPrograms()); } catch { /* compiled on first use */ }
  await warmPrograms(list, () => job === warmJob && canvas.ready);
}

export function teardown() {
  clearTimeout(timer); timer = 0; clearTimeout(shelterTimer); shelterTimer = 0;
  clearTimeout(tornadoTimer); tornadoTimer = 0;
  tornado?.destroy(); tornado = null;
  cancelIdle();
  display?.destroy(); display = null;
  steam?.destroy(); steam = null;
  clouds?.destroy(); clouds = null;
  lens?.destroy?.(); lens = null;
  info?.texture?.destroy(true); info = null; infoKey = "";
  shelter?.texture?.destroy(true); shelter = null; shelterKey = "";
  lastState = null;
  wetCache = { t: -1, v: null }; wetSince = null;
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
  syncTornadoes();
  const now = sharedNow(), st = shown() ? clientState(now) : null;
  const live = !!st && (Object.keys(st.fx).length > 0 || st.wet > 0.002 || st.cover > 0.002);
  lastState = st;
  if ( !live ) {
    if ( display ) { display.destroy(); display = null; }
    if ( lens ) { lens.destroy(); lens = null; }
    if ( steam ) { steam.destroy(); steam = null; }
    if ( clouds ) { clouds.destroy(); clouds = null; }
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
  syncSteam();
  syncClouds(st);
}

/** The cloud layer (clouds.mjs): the Clouds weather and the wind's cloud shadows, one field; no cover -> no display. */
function syncClouds(st) {
  const want = !!st && (!!st.fx.clouds || (st.fx.wind?.p > 0 && st.fx.wind.s > 0.02));
  if ( !want ) { if ( clouds ) { clouds.destroy(); clouds = null; } return; }
  try {
    clouds ??= new CloudDisplay();
    clouds.now = sharedNow;
    clouds.setState(st, P, sharedNow());
  } catch ( err ) { console.warn(`${MODULE_ID} | weather: clouds`, err); clouds?.destroy(); clouds = null; }
}

/** Steam over fire (steam.mjs): while the weather is live; its ticker returns at once when no fire is under rain or snow. */
function syncSteam() {
  try {
    steam ??= new SteamLayer();
    steam.now = sharedNow; steam.view = viewOf;
    steam.wind = () => {
      const w = lastState?.wind, g = geo(); if ( !w || !(w.str > 0) ) return [0, 0];
      const a = (w.dir ?? 0) * Math.PI / 180, v = w.str * SPEED_SQ * (g.grid / g.ap) * 0.5;
      return [Math.cos(a) * v, Math.sin(a) * v];
    };
    steam.arm(!reducedMotion());
  } catch ( err ) { console.warn(`${MODULE_ID} | weather: steam`, err); steam?.destroy(); steam = null; }
}

/* ---------------------------------------------------------------- tornadoes (their own display: tornado.mjs) */

/**
 * Show the scene's tornadoes that are forming, on the ground or roping out; none -> no display. One that starts later is a timer;
 * one that is finished drops out (the display tells when all of its tornadoes are gone).
 */
function syncTornadoes() {
  clearTimeout(tornadoTimer); tornadoTimer = 0;
  if ( !canvas.ready || !canvas.scene ) return;
  const now = sharedNow(), grid = canvas.grid?.size ?? 100;
  const list = shown() ? P.tornadoes.filter((T) => !TM.phase(T, now, grid).gone) : [];
  const live = list.filter((T) => T.t0 <= now + 1000), later = list.filter((T) => T.t0 > now + 1000);
  if ( later.length ) tornadoTimer = setTimeout(() => { tornadoTimer = 0; syncTornadoes(); }, Math.min(2 ** 31 - 1, Math.min(...later.map((T) => T.t0)) - now - 900));
  if ( !live.length ) { if ( tornado ) { tornado.destroy(); tornado = null; } return; }
  try {
    tornado ??= new TornadoDisplay();
    tornado.now = sharedNow;
    tornado.onEmpty = () => setTimeout(syncTornadoes, 0);
    tornado.sync(live, geo(), { view: viewOf(), cap: detailCap(), still: reducedMotion() });
  } catch ( err ) { console.warn(`${MODULE_ID} | weather: tornado`, err); tornado?.destroy(); tornado = null; }
}

/** A GM edit of the tornado list: the finished ones are dropped, the list cleaned, saved; every client follows the flag. */
function saveTornadoes(list) {
  const now = sharedNow(), grid = canvas.grid?.size ?? 100;
  P = M.cleanParams({ ...P, tornadoes: list.filter((T) => !TM.phase(T, now, grid).gone) });
  syncTornadoes(); tell("changed");
  return save();
}

export const tornadoApi = {
  /**
   * A new tornado (GM): `path` = scene points [[x, y], ...] or [{ x, y }, ...] (one point: it stays there, wandering); { level 1..3,
   * speed squares / s, size, wander squares, end "loop" | "stop" | "ropeOut", at shared ms }. Returns its id (null: not GM, or 3
   * already on the scene).
   */
  add(path, { level = TM.DEFAULTS.level, speed = TM.DEFAULTS.speed, size = TM.DEFAULTS.size, wander = TM.DEFAULTS.wander, end = TM.DEFAULTS.end, at = null } = {}) {
    if ( !game.user.isGM || !canvas.scene ) return null;
    const now = sharedNow(), grid = canvas.grid?.size ?? 100;
    const alive = P.tornadoes.filter((T) => !TM.phase(T, now, grid).gone);
    if ( alive.length >= TM.MAX_TORNADOES ) { ui.notifications?.warn(game.i18n.localize("MOINENMAPS.Weather.tornadoMax")); return null; }
    const id = foundry.utils.randomID(10), t0 = Math.round(at ?? now + M.LEAD_MS);
    const T = TM.cleanTornado({ id, path, t0, level, lv0: level, lvT: t0, speed, size, wander, end });
    if ( !T ) return null;
    saveTornadoes([...alive, T]);
    return id;
  },
  /** Change a tornado (GM): { level (ramps over 5 s), end, damage }. */
  update(id, patch = {}) {
    if ( !game.user.isGM ) return null;
    const now = sharedNow();
    const list = P.tornadoes.map((T) => {
      if ( T.id !== id ) return T;
      const n = { ...T };
      if ( patch.level !== undefined ) { const s = TM.levelS(T, now); n.lv0 = Math.min(3, Math.max(1, Math.round(s + 1))); n.level = Math.min(3, Math.max(1, Math.round(Number(patch.level)) || T.level)); n.lvT = Math.round(now); }
      if ( patch.end !== undefined && TM.ENDS.includes(patch.end) ) n.end = patch.end;
      if ( patch.damage !== undefined ) n.damage = patch.damage === true;
      return n;
    });
    saveTornadoes(list);
    return P.tornadoes.find((T) => T.id === id) ?? null;
  },
  /** Send a tornado away (GM): it ropes out over a few seconds; { now: true } removes it at once. */
  remove(id, { now: cut = false } = {}) {
    if ( !game.user.isGM ) return;
    const now = Math.round(sharedNow() + M.LEAD_MS);
    saveTornadoes(cut ? P.tornadoes.filter((T) => T.id !== id) : P.tornadoes.map((T) => T.id === id && (T.out === null || T.out > now) ? { ...T, out: now } : T));
  },
  /** Every tornado ropes out (GM); { now: true } removes them at once. */
  clear({ now: cut = false } = {}) {
    if ( !game.user.isGM ) return;
    const now = Math.round(sharedNow() + M.LEAD_MS);
    saveTornadoes(cut ? [] : P.tornadoes.map((T) => (T.out === null || T.out > now) ? { ...T, out: now } : T));
  },
  /** The scene's tornadoes with where they are now: [{ ...record, x, y, phase, s }]. */
  list() {
    const now = sharedNow(), grid = canvas.grid?.size ?? 100;
    return P.tornadoes.map((T) => { const [x, y] = TM.baseAt(T, now, grid); return { ...foundry.utils.deepClone(T), x, y, phase: TM.phase(T, now, grid), s: TM.levelS(T, now) }; });
  },
  /** Where a tornado's base is at shared ms `t` (default now): { x, y } scene px, or null. */
  positionAt(id, t = sharedNow()) { const T = P.tornadoes.find((T) => T.id === id); if ( !T ) return null; const [x, y] = TM.baseAt(T, t, canvas.grid?.size ?? 100); return { x, y }; },
  /** The wind a tornado adds at a scene point now: { x, y } squares / s. */
  windAt(x, y) {
    const g = canvas.grid?.size ?? 100; let vx = 0, vy = 0;
    for ( const v of TM.vortices(P.tornadoes, sharedNow(), g) ) { const [a, b] = TM.vortexWind(v, x / g, y / g); vx += a; vy += b; }
    return { x: vx, y: vy };
  },
  display: () => tornado,
  model: TM
};

/* ---------------------------------------------------------------- rain and snow over fire (research D9) */

/**
 * What the weather does to fire now, for the fire layer (wind.mjs fireWet): the WORLD state (no client caps: every client that sees
 * the weather dims the fire the same), cached for 50 ms. null = nothing (weather off, hidden from this player, or no keys).
 */
let wetCache = { t: -1, v: null };
function fireWetNow() {
  if ( !P.on || !canvas.scene || (P.who === "gm" && !game.user.isGM) || (!P.keys.length && !P.base) ) return null;
  const now = sharedNow(), t = Math.floor(now / 50);
  if ( t !== wetCache.t ) { const w = M.fireWet(M.resolve(P, now)); wetCache = { t, v: w.dim > 0 || w.steam > 0 ? w : null }; }
  return wetCache.v;
}

/**
 * RAIN PUTS FIRE OUT (opt-in per scene, P.fire.out): once it has rained hard enough for long enough (rain table fireOut: 90 / 45 / 20 s
 * at levels 1 / 2 / 3, presence at least 0.5), the active GM puts every burning fire stroke out through the fire API (one write; the
 * fire goes out on every client with its own out animation; undoable). Checked at most once a second; one writer, idempotent.
 */
let wetSince = null, outChecked = 0;
function fireOutCheck(now = sharedNow()) {
  if ( now - outChecked < 1000 ) return;
  outChecked = now;
  if ( !P.fire.out || !P.on || game.users?.activeGM !== game.user ) { wetSince = null; return; }
  const w = M.fireWet(M.resolve(P, now));
  if ( !Number.isFinite(w.outAfter) ) { wetSince = null; return; }
  wetSince ??= now;
  if ( now - wetSince < w.outAfter * 1000 ) return;
  wetSince = null;
  const F = moduleApi.fire; if ( !F?.list ) return;
  const ids = F.list().filter((x) => x.k === "fire" && x.o === undefined).map((x) => x.id);
  if ( ids.length ) F.remove(ids);
}

/** At most 12 times a second (the display's ticker): the state moves along the timeline. */
function step() {
  if ( !display ) return;
  const st = clientState();
  lastState = st;
  if ( !Object.keys(st.fx).length && st.wet <= 0.002 && st.cover <= 0.002 && st.steady ) { refresh(); return; }
  display.setState(st);
  syncLens(st);
  syncClouds(st);
  fireOutCheck();
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
  P = M.cleanParams({ ...P, ...patch, ground: { ...P.ground, ...(patch.ground ?? {}) }, lens: { ...P.lens, ...(patch.lens ?? {}) }, fire: { ...P.fire, ...(patch.fire ?? {}) },
    clouds: { ...P.clouds, ...(patch.clouds ?? {}) } });
  refresh(); tell("params");
  save();
}

/** The cloud layer's look (GM): { mode "sky" | "shadows", rays }; each switch fades on the shared clock from a moment just ahead. */
export function setCloudLook({ mode, rays } = {}) {
  if ( !game.user.isGM ) return;
  const C = { ...P.clouds }, t = Math.round(sharedNow() + M.LEAD_MS);
  // (a switch back during a running fade starts from where the fade is: the new fade's start is moved so the weight is continuous)
  const flip = (on, T) => { const w = M.cloudSwitch(on, T, t); return t - Math.round(M.CLOUD_FADE * inv(on ? 1 - w : w)); };
  if ( mode !== undefined && M.CLOUD_MODES.includes(mode) && mode !== C.mode ) { C.modeT = flip(C.mode === "sky", C.modeT); C.mode = mode; }
  if ( rays !== undefined && !!rays !== C.rays ) { C.raysT = flip(C.rays, C.raysT); C.rays = !!rays; }
  setParams({ clouds: C });
}
/** The inverse of the smoothstep on 0..1 (the fade's progress for a weight). */
const inv = (y) => { y = Math.min(1, Math.max(0, y)); return 0.5 - Math.sin(Math.asin(1 - 2 * y) / 3); };

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
    info: !!info, shelter: !!shelter, ...(display?.stats ?? {}), lensStats: lens?.stats ?? null, tornado: tornado ? { ...tornado.stats } : null, steam: steam ? { ...steam.stats } : null, clouds: clouds ? { ...clouds.stats, on: clouds.ticking } : null, fireWet: fireWetNow(), state: lastState }),
  /** The cloud layer: { level 0 (off) .. 3, mode "sky" | "shadows", rays true | false }, { over ms } (GM). */
  clouds({ level, mode, rays } = {}, { over = M.DEFAULT_DUR } = {}) {
    if ( mode !== undefined || rays !== undefined ) setCloudLook({ mode, rays });
    if ( level !== undefined ) change({ clouds: Math.max(0, Math.min(3, Math.round(Number(level)) || 0)) }, { over });
    return { level: M.current(P)?.fx?.clouds?.l ?? 0, ...P.clouds };
  },
  display: () => display, lensDisplay: () => lens, cloudDisplay: () => clouds, tornadoDisplay: () => tornado, steamDisplay: () => steam, guard: guardInfo, refresh, model: M, geo,
  tornado: tornadoApi
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
  setVortexProvider(() => (P.on && canvas.scene && P.tornadoes.length ? TM.vortices(P.tornadoes, sharedNow(), canvas.grid?.size ?? 100) : []));
  setFireWetProvider(fireWetNow);
  Hooks.once("init", registerWeatherSettings);
  Hooks.on("canvasReady", onCanvasReady);
  Hooks.on("canvasTearDown", teardown);
  Hooks.on("updateScene", onUpdateScene);
  Hooks.on("moinenMapsPerfMode", () => refresh());
  Hooks.on("moinenMapsDestruction", (kind) => { if ( kind === "loaded" && display ) refresh(); });
  for ( const h of ["createTile", "updateTile", "deleteTile", "createRegion", "updateRegion", "deleteRegion", "createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior"] ) Hooks.on(h, shelterSoon);
  Hooks.once("ready", () => { const m = game.modules.get(MODULE_ID); if ( m ) { m.api ??= moduleApi; m.api.weather ??= weatherApi; } });
}
