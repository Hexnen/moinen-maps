import { MODULE_ID } from "../config.mjs";
import * as Model from "./model.mjs";
import { engineInfo, bake, ramp, disposeEngine } from "./engine.mjs";
import { WaterDisplay } from "./display.mjs";
import * as Cache from "./cache.mjs";
import { publishBake, fetchBake } from "./publish.mjs";
import { CODES } from "./codes-table.mjs";

/**
 * The water of the open scene: loads its masks and settings from the scene flag, bakes them in the worker, plays the result, and
 * lets the GM edit (painting, settings) with the changes baked and saved after a short pause. Every client bakes for itself; the
 * bake is deterministic (the seed is a setting), so everyone sees the same water.
 */

let S = null, display = null, info = null, lite = null;
let gen = 0, bakeTimer = 0, saveTimer = 0;
const status = { baking: false, progress: 0, error: "" };

/** Settings that only change colours: no new bake. */
const COLOR_ONLY = new Set(["colors", "alpha", "palBase", "palHue", "palSat", "palRange"]);
/** Settings the display reads itself. */
const LIVE_ONLY = new Set(["ms", "fxOn", "fxStrength", "fxRings", "fxSplash", "fxWake", "fxWho", "reflectOn", "reflectType", "reflectOpacity", "reflectOffset", "reflectBlurType", "reflectRipple", "reflectAmp", "reflectFreq", "reflectSpeed", "reflectScan", "reflectScanValue", "reflectLength", "reflectFade", "reflectTint", "reflectWho", "submergeOn", "submergeStrength", "submergeDepth", "submergeBubbles", "submergeWho"]);

const tell = (kind) => Hooks.callAll("moinenMapsWater", kind);

export const state = () => S;
export const waterInfo = () => info;
/** The engine's tables: the full ones once the worker has run, else the cached codes and defaults. */
const tables = () => info ?? lite;
export const waterStatus = () => status;

/* ---------------------------------------------------------------- lifecycle */

export async function onCanvasReady() {
  teardown();
  const scene = canvas.scene;
  S = scene ? Model.load(scene) : null;
  if ( S?.enabled && Model.hasPaint(S) ) await start();
  tell("loaded");
}

export function teardown() {
  gen++;
  clearTimeout(bakeTimer); clearTimeout(saveTimer); clearTimeout(repaintTimer); clearTimeout(releaseTimer); clearTimeout(publishTimer); bakeTimer = saveTimer = repaintTimer = releaseTimer = publishTimer = 0;
  display?.destroy(); display = null;
  S = null; status.baking = false; status.progress = 0; status.error = "";
}

/** Another client saved the water: take it over. */
export async function onUpdateScene(scene, changed, options, userId) {
  if ( scene.id !== canvas.scene?.id || userId === game.user.id ) return;
  if ( !foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.${Model.FLAG}`) ) return;
  S = Model.load(scene);
  if ( S?.enabled && Model.hasPaint(S) ) { await start(); } else { display?.clear(); }
  tell("loaded");
}

async function start() {
  try {
    await ensureTables();
  } catch ( err ) {
    console.error(`${MODULE_ID} | water engine`, err);
    status.error = String(err?.message ?? err); tell("status");
    return;
  }
  S.params = { ...foundry.utils.deepClone(tables().defaults), ...S.params };
  if ( !Array.isArray(S.params.guides) ) S.params.guides = [];
  display ??= new WaterDisplay();
  display.setPalette(tables().codes, S.params.colors, S.params.alpha);
  await rebake();
}

/**
 * The worker holds 100+ MB for a big scene. A player never edits, so it is let go as soon as the water is baked; the GM keeps it
 * a couple of minutes (settings changes reuse what it prepared) and then lets it go too. A new bake starts it again.
 */
let releaseTimer = 0;
function releaseWorker() {
  clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => { releaseTimer = 0; if ( !status.baking ) disposeEngine(); }, game.user.isGM ? 120000 : 1500);
}

/* ---------------------------------------------------------------- publishing the bake (GM) */

let publishTimer = 0, publishFailed = false;
/** A few seconds after the last bake the GM uploads it to the world folder, so players need not bake. */
function schedulePublish(key, bake) {
  clearTimeout(publishTimer);
  if ( !game.user.isGM || publishFailed || !S ) return;
  publishTimer = setTimeout(async () => {
    publishTimer = 0;
    const scene = canvas.scene;
    if ( !S || !scene || S.baked?.key === key || Cache.makeKey(scene.id, S) !== key ) return;     // edited again meanwhile
    try {
      await save();                                              // the masks and settings first, so the key means the same to everyone
      const baked = await publishBake(scene.id, key, bake);
      S.baked = baked;
      await scene.update({ [`flags.${MODULE_ID}.${Model.FLAG}.baked`]: baked });
    } catch ( err ) {
      publishFailed = true;
      console.warn(`${MODULE_ID} | could not publish the baked water`, err);
      ui.notifications.warn(game.i18n.localize("MOINENMAPS.Water.publishFailed"));
    }
  }, 3000);
}

/** The GM always starts the worker (the settings window needs the looks); a player with a cached scene does not. */
async function ensureTables() {
  if ( game.user.isGM ) { info ??= await engineInfo(); return; }
  if ( info || lite ) return;
  // a player who only plays a published or cached bake needs the code table and nothing else: no worker
  lite = { codes: CODES, defaults: (await Cache.getMeta())?.defaults ?? {} };
}

/* ---------------------------------------------------------------- baking */

function scheduleBake(ms = 350) {
  clearTimeout(bakeTimer);
  bakeTimer = setTimeout(() => { bakeTimer = 0; rebake(); }, ms);
}

export async function rebake() {
  if ( !S ) return;
  const my = ++gen, scene = canvas.scene;
  if ( !Model.hasPaint(S) ) { display?.clear(); status.baking = false; tell("status"); return; }
  if ( !S.enabled ) return;
  try {
    await ensureTables();
    display ??= new WaterDisplay();
    display.setPalette(tables().codes, S.params.colors, S.params.alpha);
  } catch ( err ) { status.error = String(err?.message ?? err); tell("status"); return; }
  const origin = { x: Model.sceneRect(scene).x, y: Model.sceneRect(scene).y };
  // baked before on this browser, or published by the GM: no worker, no waiting
  const key = Cache.makeKey(scene.id, S);
  let hit = await Cache.getBake(key);
  if ( my !== gen ) return;
  if ( !hit && S.baked?.key === key ) {
    hit = await fetchBake(S.baked);
    if ( my !== gen ) return;
    if ( hit ) Cache.putBake(key, { box: hit.box, ms: hit.ms, frames: hit.frames.map((f) => f.slice()) });
  }
  if ( hit ) {
    if ( S.baked?.key !== key ) schedulePublish(key, hit);     // baked here before but never uploaded
    display.begin(hit.box, S.px, origin, hit.ms ?? S.params.ms);
    hit.frames.forEach((f, i) => display.addFrame(i + 1, f));
    display.commit();
    status.baking = false; status.progress = 1; tell("status");
    releaseWorker();
    return;
  }
  clearTimeout(releaseTimer);
  status.baking = true; status.progress = 0; status.error = ""; tell("status");
  const frames = [];
  try {
    const res = await bake({ W: S.w, H: S.h, masks: S.masks, maskKey: `${scene.id}:${S.px}:${S.rev}`, params: S.params }, {
      onBegin: (b) => { if ( my === gen ) display.begin(b.box, S.px, origin, b.ms ?? S.params.ms); },
      onFrame: (i, levels) => { if ( my === gen ) { display.addFrame(i, levels); frames[i - 1] = levels; } },
      onProgress: (p) => { if ( my === gen ) { status.progress = p; tell("status"); } }
    });
    if ( my !== gen || res?.superseded ) return;
    if ( res?.empty ) display?.clear();
    else {
      display?.commit();
      if ( frames.length === res.frames && frames.every(Boolean) ) {
        Cache.putBake(key, { box: res.box, ms: res.ms, frames: frames.map((f) => f.slice()) });
        if ( info ) { Cache.putMeta(info.codes, info.defaults); if ( info.codes.length === CODES.length && info.codes.some((v, i) => v !== CODES[i]) ) console.warn(`${MODULE_ID} | codes-table.mjs is out of date with lib/wowe/codes.lua`); }
        schedulePublish(key, { box: res.box, ms: res.ms, frames });
      }
    }
  } catch ( err ) {
    if ( my === gen ) { console.error(`${MODULE_ID} | water bake`, err); status.error = String(err?.message ?? err); }
  }
  if ( my === gen ) { status.baking = false; status.progress = 1; tell("status"); }
  if ( my === gen ) releaseWorker();
}

/* ---------------------------------------------------------------- editing (GM) */

/** The editable water set, created (empty) when the scene has none yet. */
export async function ensureState() {
  if ( S ) return S;
  info ??= await engineInfo();
  S = Model.blank(info.defaults);
  tell("loaded");
  return S;
}

/** Masks changed (painting): bake and save after a pause. */
export function edited() {
  if ( !S ) return;
  S.rev = Model.nextRev();
  scheduleBake();
  scheduleSave();
  tell("edited");
}

/** Set one setting (or several). Colour-only settings repaint at once; the rest bake again. */
export function setParams(patch) {
  if ( !S ) return;
  Object.assign(S.params, patch);
  const keys = Object.keys(patch);
  if ( keys.some((k) => !COLOR_ONLY.has(k) && !LIVE_ONLY.has(k)) ) scheduleBake();
  if ( keys.some((k) => k === "colors" || k === "alpha") ) scheduleRepaint();
  if ( keys.includes("ms") && display?.set ) display.set.ms = S.params.ms;
  scheduleSave();
  tell("params");
}

/** Repaint the frames at most about ten times a second: a slider fires many events and every repaint redraws all the frames. */
let repaintTimer = 0;
function scheduleRepaint() {
  if ( repaintTimer ) return;
  repaintTimer = setTimeout(() => { repaintTimer = 0; if ( S && info ) display?.setPalette(info.codes, S.params.colors, S.params.alpha); }, 100);
}

/** Take the settings of one of the engine's looks (colours and every slider), keeping frames, frame time, seed, rods and opacity. */
export function applyLook(name) {
  const look = info?.looks?.[name]; if ( !look || !S ) return;
  const keep = ["frames", "ms", "seed", "alpha", "guides", "guideOn", "guideStrength", "guideReach", "guideFoam", "drift", "angle", "rangle",
    "tide", "tideAmp", "tideCycles", "tideUneven", "tideWet", "palHue", "palSat", "palRange"];
  const next = { ...foundry.utils.deepClone(info.defaults), ...Object.fromEntries(keep.filter((k) => k in S.params).map((k) => [k, S.params[k]])) };
  Object.assign(next, foundry.utils.deepClone(look), { style: name, clean: look.clean === true });
  S.params = next;
  display?.setPalette(info.codes, S.params.colors, S.params.alpha);
  scheduleBake(150); scheduleSave(); tell("params");
}

/** Six colours from one (the engine's palette maker). */
export async function colorsFrom(hex, hue, sat, range) {
  const cols = await ramp(hex, hue, sat, range);
  setParams({ colors: cols, palBase: hex, palHue: hue, palSat: sat, palRange: range });
}

export function setEnabled(on) {
  if ( !S ) return;
  S.enabled = !!on;
  if ( on ) start(); else { gen++; display?.clear(); }
  scheduleSave(); tell("params");
}

/** A new art-pixel size: the masks are carried over to the new grid. */
export function setPx(px) {
  if ( !S ) return;
  const next = Model.resample(S, px);
  if ( next.px === S.px ) return;
  S = next;
  edited();
}

export function clearAll() {
  if ( !S ) return;
  for ( const l of Model.LAYERS ) S.masks[l].fill(0);
  edited();
}

export function newVariation() { setParams({ seed: Math.floor(Math.random() * 99999) + 1 }); }

/* ---------------------------------------------------------------- saving */

function scheduleSave(ms = 900) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = 0; save(); }, ms);
}

export async function save() {
  if ( !S || !game.user.isGM || !canvas.scene ) return;
  const scene = canvas.scene;
  await scene.update({ [`flags.${MODULE_ID}.${Model.FLAG}`]: Model.encode(S) });
}
