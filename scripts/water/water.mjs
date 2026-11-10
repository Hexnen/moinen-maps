import { MODULE_ID } from "../config.mjs";
import * as Model from "./model.mjs";
import { engineInfo, bake, ramp, disposeEngine } from "./engine.mjs";
import { WaterDisplay } from "./display.mjs";
import * as Cache from "./cache.mjs";
import { publishBake, fetchBake } from "./publish.mjs";
import { scheduleGc } from "../net/stream.mjs";
import { markOnce } from "../net/trace.mjs";
import * as Reveal from "../net/reveal.mjs";
import "../net/preload.mjs";   // reads a scene's chunks ahead (canvasInit) and warms the codec workers
import { CODES } from "./codes-table.mjs";
import * as Progress from "../progress.mjs";

/**
 * The water of the open scene: loads its masks and settings from the scene flag, bakes them in the worker, plays the result, and
 * lets the GM edit (painting, settings) with the changes baked and saved after a short pause. Every client bakes for itself; the
 * bake is deterministic (the seed is a setting), so everyone sees the same water.
 */

let S = null, display = null, info = null, lite = null;
let gen = 0, bakeTimer = 0, saveTimer = 0;
/** Bumped by every teardown (scene change): async work started for one scene stops when it comes back to another. */
let life = 0;
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
  const my = life;
  if ( S?.enabled && Model.hasPaint(S) ) {
    Reveal.expect("water");                      // part of the scene's one reveal (net/reveal.mjs)
    markOnce("water:start");
    await start();
    // every frame's texture on the GPU before the reveal, not one per frame while the loop first plays
    if ( my === life && Reveal.holding("water") && display?.set ) await Reveal.upload(display.set.textures.filter(Boolean).map((t) => t.baseTexture));
  }
  if ( my === life ) Reveal.ready("water");
  tell("loaded");
}

export function teardown() {
  flushSave();
  gen++; life++;
  clearTimeout(bakeTimer); clearTimeout(saveTimer); clearTimeout(repaintTimer); clearTimeout(releaseTimer); clearTimeout(publishTimer); bakeTimer = saveTimer = repaintTimer = releaseTimer = publishTimer = 0;
  publishBackoff = 0; publishRetryAt = 0;        // a failed upload on the last scene does not hold up the next one
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
  // the first start waits for the worker: a scene change meanwhile (teardown) must not let this one go on with the next scene's
  // water (or with none: S is null then)
  const my = life;
  try {
    await ensureTables();
  } catch ( err ) {
    if ( my !== life ) return;
    console.error(`${MODULE_ID} | water engine`, err);
    status.error = String(err?.message ?? err); tell("status");
    return;
  }
  if ( my !== life || !S ) return;
  markOnce("water:tables");
  S.params = { ...foundry.utils.deepClone(tables().defaults), ...S.params };
  if ( !Array.isArray(S.params.guides) ) S.params.guides = [];
  display ??= new WaterDisplay();
  Reveal.attach("water", display.root);
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

/**
 * A failed upload is tried again after a growing pause (15 s doubling up to 8 min, like the destruction's), so one passing network
 * or storage error does not leave the players baking for themselves until the page is reloaded. Leaving the scene starts afresh.
 */
let publishTimer = 0, publishBackoff = 0, publishRetryAt = 0;
/** A few seconds after the last bake the GM uploads it to the world folder, so players need not bake. */
function schedulePublish(key, bake) {
  clearTimeout(publishTimer);
  if ( !game.user.isGM || !S ) return;
  // the bake itself already waited for the edits to settle, and only the changed tiles go up: a short pause is enough
  const wait = Math.max(1200, publishRetryAt - Date.now());
  publishTimer = setTimeout(async () => {
    publishTimer = 0;
    const scene = canvas.scene;
    if ( !S || !scene || (S.baked?.key === key && S.baked?.v === 2) || Cache.makeKey(scene.id, S) !== key ) return;     // edited again meanwhile
    const my = life;
    try {
      await save();                                              // the masks and settings first, so the key means the same to everyone
      if ( my !== life ) return;                                 // left the scene meanwhile
      const baked = await publishBake(scene.id, key, bake);
      if ( my === life ) S.baked = baked;                        // the upload belongs to that scene even when we have left it
      await scene.update({ [`flags.${MODULE_ID}.${Model.FLAG}.baked`]: baked });
      publishBackoff = 0; publishRetryAt = 0;
      scheduleGc(scene.id);                                      // tiles no manifest names any more go, much later

    } catch ( err ) {
      if ( !publishBackoff ) ui.notifications.warn(game.i18n.localize("MOINENMAPS.Water.publishFailed"));
      publishBackoff = Math.min(8 * 60000, publishBackoff ? publishBackoff * 2 : 15000);
      publishRetryAt = Date.now() + publishBackoff;
      console.warn(`${MODULE_ID} | could not publish the baked water (next try in ${publishBackoff / 1000} s)`, err);
      if ( my === life ) schedulePublish(key, bake);             // the same bake, once the pause is over (unless edited again)
    }
  }, wait);
}

/** The GM always starts the worker (the settings window needs the looks); a player with a cached scene does not. */
async function ensureTables() {
  if ( game.user.isGM ) {
    if ( info ) return;
    // the GM's worker starts now, but a scene whose water is cached or published does not wait for it (its start took ~0.5 s of
    // every scene load): the cached code table and defaults are enough to show it
    markOnce("water:boot");
    const boot = engineInfo().then((i) => { info = i; tell("status"); return i; });
    markOnce("water:booted");
    if ( lite ) { boot.catch((err) => console.warn(`${MODULE_ID} | water engine`, err)); return; }
    const meta = await earlyMeta();
    markOnce("water:meta");
    if ( meta?.defaults && Object.keys(meta.defaults).length ) { lite ??= { codes: CODES, defaults: meta.defaults }; boot.catch((err) => console.warn(`${MODULE_ID} | water engine`, err)); return; }
    info ??= await boot;
    return;
  }
  if ( info || lite ) return;
  // a player who only plays a published or cached bake needs the code table and nothing else: no worker
  markOnce("water:lite", { early: !!early });
  // (the read-ahead's answer even when it is "no table here": asking IndexedDB again waits behind the scene's first frame)
  const m0 = earlyValue ? earlyValue.meta : await earlyMeta();
  lite = { codes: CODES, defaults: m0?.defaults ?? {} };
  markOnce("water:liteDone");
}

/*
 * Reading ahead: at canvasInit - before Foundry's first frame of the scene holds the page for a few hundred ms - the cached code table
 * and the scene's cached frames come out of IndexedDB. The load uses them when the key still matches (it is checked as always).
 */
let early = null, earlyValue = null;
/** The cached table: straight from the read-ahead when it is in (no await: a continuation can wait behind the scene's first frame). */
const earlyMeta = () => earlyValue ? earlyValue.meta : (async () => early ? (await early)?.meta ?? null : Cache.getMeta())();
Hooks.on("canvasInit", () => {
  early = null; earlyValue = null;
  const scene = canvas.scene;
  if ( !scene?.flags?.[MODULE_ID]?.[Model.FLAG] ) return;
  early = (async () => {
    markOnce("water:early");
    const meta = await Cache.getMeta();
    markOnce("water:earlyMeta");
    const S1 = Model.load(scene);
    if ( !S1?.enabled || !Model.hasPaint(S1) ) return (earlyValue = { meta });
    S1.params = { ...foundry.utils.deepClone(meta?.defaults ?? {}), ...S1.params };
    if ( !Array.isArray(S1.params.guides) ) S1.params.guides = [];
    const key = Cache.makeKey(scene.id, S1);
    const hit = await Cache.getBake(key);
    markOnce("water:earlyBake", { hit: !!hit });
    return (earlyValue = { meta, key, hit });
  })().catch(() => null);
});

/* ---------------------------------------------------------------- baking */

function scheduleBake(ms = 350) {
  clearTimeout(bakeTimer);
  bakeTimer = setTimeout(() => { bakeTimer = 0; rebake(); }, ms);
}

/** How long a player waits for the GM's upload of new water before baking it himself. */
const AWAIT_PUBLISH = 12000;

export async function rebake({ awaitPublish = true } = {}) {
  if ( !S ) return;
  clearTimeout(bakeTimer); bakeTimer = 0;
  const my = ++gen, scene = canvas.scene;
  if ( !Model.hasPaint(S) ) { display?.clear(); status.baking = false; tell("status"); return; }
  if ( !S.enabled ) return;
  try {
    await ensureTables();
    if ( my !== gen || !S ) return;                   // the scene changed while the tables loaded
    display ??= new WaterDisplay();
    display.setPalette(tables().codes, S.params.colors, S.params.alpha);
  } catch ( err ) { status.error = String(err?.message ?? err); tell("status"); return; }
  const origin = { x: Model.sceneRect(scene).x, y: Model.sceneRect(scene).y };
  // baked before on this browser, or published by the GM: no worker, no waiting
  const key = Cache.makeKey(scene.id, S);
  const ahead = earlyValue ?? (early ? await early : null);
  early = null; earlyValue = null;
  let hit = ahead?.key === key && ahead.hit ? ahead.hit : await Cache.getBake(key), hitFrom = "idb";
  if ( my !== gen ) return;
  if ( !hit && S.baked?.key === key ) {
    hit = await fetchBake(S.baked); hitFrom = "net";
    if ( my !== gen ) return;
    if ( hit ) Cache.putBake(key, { box: hit.box, ms: hit.ms, frames: hit.frames.map((f) => f.slice()) });
  }
  if ( hit ) {
    markOnce("water:frames", { from: hitFrom });
    if ( S.baked?.key !== key || S.baked?.v !== 2 ) schedulePublish(key, hit);     // baked here before but never uploaded (or in the first format)
    display.begin(hit.box, S.px, origin, hit.ms ?? S.params.ms);
    hit.frames.forEach((f, i) => display.addFrame(i + 1, f));
    display.commit();
    markOnce("water:shown", { from: hitFrom });
    status.baking = false; status.progress = 1; tell("status");
    releaseWorker();
    return;
  }
  // a player whose GM is painting: the GM's client uploads the new water a few seconds after it has baked it, so wait for that
  // (the water shown so far stays) and bake here only when it does not come
  if ( awaitPublish && !game.user.isGM && game.users.activeGM ) {
    bakeTimer = setTimeout(() => { bakeTimer = 0; rebake({ awaitPublish: false }); }, AWAIT_PUBLISH);
    return;
  }
  clearTimeout(releaseTimer);
  status.baking = true; status.progress = 0; status.error = ""; tell("status");
  const frames = [];
  // PROGRESS (progress.mjs): the engine's preparation (one long step: the bar creeps on at its learned length), then its frames
  Progress.current("water")?.drop();   // (a bake this one supersedes: its work is no longer to do)
  const pj = Progress.job("water", { title: "MOINENMAPS.Prog.title.water" }), guess = Math.max(1, Number(S.params?.frames) || 24);
  pj.plan("waterFrame", guess);
  const prep = pj.run("waterPrep", 1);
  let fr = null, nFrames = guess;
  pj.stage("MOINENMAPS.Prog.st.waterPrep");
  try {
    const res = await bake({ W: S.w, H: S.h, masks: S.masks, maskKey: `${scene.id}:${S.px}:${S.rev}`, params: S.params }, {
      onBegin: (b) => {
        if ( my !== gen ) return;
        display.begin(b.box, S.px, origin, b.ms ?? S.params.ms);
        prep.end(); nFrames = b.frames || guess;
        fr = pj.run("waterFrame", nFrames, { preplanned: Math.min(nFrames, guess) });
        pj.stage("MOINENMAPS.Prog.st.waterFrames", { done: 0, total: nFrames });
      },
      onFrame: (i, levels) => { if ( my === gen ) { display.addFrame(i, levels); frames[i - 1] = levels; fr?.set(i); pj.stage("MOINENMAPS.Prog.st.waterFrames", { done: i, total: nFrames }); } },
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
    if ( my === gen ) disposeEngine();     // a failed bake may leave the engine broken: the next bake starts a fresh one
  }
  if ( my === gen ) { status.baking = false; status.progress = 1; tell("status"); }
  if ( my === gen ) Progress.end("water", !status.error); else if ( Progress.current("water") === pj ) Progress.end("water", false);
  if ( my === gen ) releaseWorker();
}

/* ---------------------------------------------------------------- editing (GM) */

/** The editable water set, created (empty) when the scene has none yet. */
export async function ensureState() {
  if ( S ) return S;
  const my = life, sceneId = canvas.scene?.id;
  info ??= await engineInfo();
  if ( my !== life || canvas.scene?.id !== sceneId ) return null;   // left the scene meanwhile: nothing to paint on
  if ( S ) return S;                                   // loaded (or created by another caller) while the engine started
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

let saveSceneId = null;
function scheduleSave(ms = 900) {
  clearTimeout(saveTimer);
  saveSceneId = canvas.scene?.id ?? null;
  saveTimer = setTimeout(() => { saveTimer = 0; save(); }, ms);
}

/** Leaving the scene (teardown) while an edit still waits for its save: save it now, to the scene it was made on. */
function flushSave() {
  if ( !saveTimer || !S || !game.user.isGM ) return;
  const scene = game.scenes.get(saveSceneId);
  const upd = scene && Model.flagUpdate(S, scene);
  if ( upd && Object.keys(upd).length ) scene.update(upd).catch((err) => console.warn(`${MODULE_ID} | could not save the water`, err));
}

export async function save() {
  if ( !S || !game.user.isGM || !canvas.scene ) return;
  const scene = canvas.scene;
  const upd = Model.flagUpdate(S, scene);
  if ( Object.keys(upd).length ) await scene.update(upd);           // only the changed masks and fields; nothing changed, no write
}
