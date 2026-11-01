import { MODULE_ID } from "../config.mjs";
import { api as moduleApi } from "../attrs.mjs";
import * as Model from "./model.mjs";
import { readMeta } from "./core.mjs";
import { runBake, disposeBaker } from "./bake.mjs";
import { mapPixels, backgroundInfo } from "./source.mjs";
import * as Store from "./store.mjs";
import { DestructionDisplay } from "./display.mjs";
import * as Editor from "./editor.mjs";

/**
 * The destruction of the open scene: loads the mask from the scene flag, bakes it (worker) or takes a cached or published bake,
 * shows it, plays the break, and takes the GM's edits (bake and save after a short pause, upload of the bake for the players).
 * Public API: `game.modules.get("moinen-maps").api.destruction`. Hook fired: "moinenMapsDestruction" ("loaded" | "edited" |
 * "params" | "status" | "brush").
 */

let S = null, display = null, gen = 0, bakeTimer = 0, saveTimer = 0, publishTimer = 0, publishFailed = false;
let shownKey = "", pendingBox = null, playedBlast = null;
const status = { baking: false, waiting: false, progress: 0, error: "", source: "", stats: null, hash: "", ms: 0, areas: [] };

export const tell = (kind) => Hooks.callAll("moinenMapsDestruction", kind);
export const state = () => S;
export const getStatus = () => status;
const origin = () => { const r = Model.sceneRect(); return { x: r.x, y: r.y }; };
const fnv = (a, h = 2166136261) => { for ( let i = 0; i < a.length; i++ ) h = Math.imul(h ^ a[i], 16777619); return h >>> 0; };

/* ---------------------------------------------------------------- lifecycle */

function onCanvasReady() {
  teardown();
  if ( !canvas.scene ) return;
  S = Model.load(canvas.scene);
  Editor.onCanvasReady();
  if ( S?.enabled && Model.hasPaint(S) ) rebake();
  tell("loaded");
}

function teardown() {
  gen++;
  for ( const t of [bakeTimer, saveTimer, publishTimer] ) clearTimeout(t);
  bakeTimer = saveTimer = publishTimer = 0;
  Editor.teardown();
  display?.destroy(); display = null;
  S = null; shownKey = ""; pendingBox = null;
  Object.assign(status, { baking: false, waiting: false, progress: 0, error: "", source: "", stats: null, hash: "", areas: [] });
}

function onUpdateScene(scene, changed, _options, userId) {
  if ( scene.id !== canvas.scene?.id ) return;
  const f = changed.flags?.[MODULE_ID];
  if ( !f || !(Model.FLAG in f || `-=${Model.FLAG}` in f) ) return;
  if ( userId === game.user.id ) return;                    // our own save: already shown
  const prev = S;
  S = Model.load(scene);
  if ( !S ) { display?.clear(); shownKey = ""; tell("loaded"); return; }
  const box = prev ? Model.diffBox(prev.mask, S.mask, S.mw) : null;
  if ( box ) pendingBox = union(pendingBox, artBox(box));
  if ( S.enabled && Model.hasPaint(S) ) rebake(); else { display?.clear(); shownKey = ""; }
  Editor.refreshOverlay();
  tell("loaded");
}

const union = (a, b) => !a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
/** Mask box -> art box (a little wider: shards near the edge of a stroke move too). */
const artBox = (b) => b && { x0: b.x0 * Model.K - 3, y0: b.y0 * Model.K - 3, x1: (b.x1 + 1) * Model.K + 3, y1: (b.y1 + 1) * Model.K + 3 };

/* ---------------------------------------------------------------- baking */

function scheduleBake(ms = 300) {
  clearTimeout(bakeTimer);
  bakeTimer = setTimeout(() => { bakeTimer = 0; rebake(); }, ms);
}

/** What the bake needs: the mask and the map's pixels around the damage (with room for thrown debris). */
function buildInput() {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for ( let i = 0; i < S.mask.length; i++ ) if ( S.mask[i] & 3 ) { const x = i % S.mw, y = (i - x) / S.mw; if ( x < x0 ) x0 = x; if ( x > x1 ) x1 = x; if ( y < y0 ) y0 = y; if ( y > y1 ) y1 = y; }
  const K = Model.K, span = Math.max(x1 - x0, y1 - y0) * K;
  const margin = Math.round(Math.min(160, Math.max(14, span * 0.6 * S.params.scatter + 10)));
  const ax0 = Math.max(0, x0 * K - margin), ay0 = Math.max(0, y0 * K - margin);
  const ax1 = Math.min(S.aw, (x1 + 1) * K + margin), ay1 = Math.min(S.ah, (y1 + 1) * K + margin);
  const box = { x0: ax0, y0: ay0, w: ax1 - ax0, h: ay1 - ay0 };
  return { mask: S.mask, mw: S.mw, mh: S.mh, K, aw: S.aw, ah: S.ah, seed: S.seed, params: S.params, map: { ...box, data: mapPixels(S.ap, box) } };
}

/** `force`: bake here even when a cached or published bake exists (a check that the bake is deterministic). */
export async function rebake({ awaitPublish = true, force = false } = {}) {
  if ( !S ) return;
  clearTimeout(bakeTimer); bakeTimer = 0;
  const my = ++gen, scene = canvas.scene;
  if ( !Model.hasPaint(S) || !S.enabled ) { display?.clear(); shownKey = ""; Object.assign(status, { baking: false, waiting: false, progress: 0 }); tell("status"); return; }
  const key = Store.makeKey(scene, S, backgroundInfo()?.path ?? "");
  if ( key === shownKey && display && !force ) { maybePlay(); return; }
  let blob = null, metaRows = 0, source = "";
  const hit = force ? null : await Store.getCached(key);
  if ( my !== gen ) return;
  if ( hit?.blob ) { blob = hit.blob; metaRows = hit.metaRows; source = "cache"; }
  if ( !blob && !force && S.baked?.key === key ) {
    blob = await Store.fetchPublished(S.baked);
    if ( my !== gen ) return;
    if ( blob ) { metaRows = S.baked.metaRows; source = "published"; Store.putCached(key, { blob, metaRows }); }
  }
  // a player whose GM is painting: wait for the GM's upload, bake here only when it does not come
  if ( !blob && awaitPublish && !game.user.isGM && game.users.activeGM ) {
    status.waiting = true; tell("status");
    bakeTimer = setTimeout(() => { bakeTimer = 0; rebake({ awaitPublish: false }); }, 12000);
    return;
  }
  status.waiting = false;
  if ( !blob ) {
    Object.assign(status, { baking: true, progress: 0, error: "" }); tell("status");
    try {
      const t0 = performance.now();
      const res = await runBake(buildInput(), { onProgress: (p) => { if ( my === gen ) { status.progress = p; tell("status"); } } });
      if ( my !== gen ) return;
      blob = await Store.encodePng(res.sheet);
      metaRows = res.metaRows; source = "baked"; status.stats = res.stats; status.ms = Math.round(performance.now() - t0);
      Store.putCached(key, { blob, metaRows, stats: res.stats });
    } catch ( err ) {
      if ( my !== gen ) return;
      console.error(`${MODULE_ID} | destruction bake`, err);
      Object.assign(status, { baking: false, error: String(err?.message ?? err) }); tell("status");
      return;
    }
  } else if ( hit?.stats ) status.stats = hit.stats;
  if ( game.user.isGM && S.baked?.key !== key ) schedulePublish(key, blob, metaRows);
  const dec = await Store.decodePng(blob);
  if ( my !== gen ) return;
  const meta = readMeta(dec.rgba, dec.w, dec.h, metaRows);
  display ??= new DestructionDisplay();
  display.show(dec.canvas, meta, S.ap, origin());
  display.setIdle(S.params.idle, S.params.fxWho);
  shownKey = key;
  Object.assign(status, { baking: false, progress: 1, source, hash: fnv(dec.rgba).toString(16), areas: display.areas.map((a) => ({ type: a.type, mat: Model.MATERIALS[a.mat + 1] ?? "earth" })) });
  tell("status");
  maybePlay();
}

/** After a new bake is on screen: play the break for what was just painted, or for a detonation that has not been seen yet. */
function maybePlay() {
  if ( !display || !S ) return;
  const motion = S.params.anim;
  const b = S.blast;
  if ( b?.id && b.id !== playedBlast ) {
    playedBlast = b.id;
    const late = game.time.serverTime - b.t;
    if ( motion && late < 15000 ) { display.play(b.box ?? null, performance.now() - late); pendingBox = null; return; }
  }
  if ( pendingBox && motion ) display.play(pendingBox);
  pendingBox = null;
}

/* ---------------------------------------------------------------- publishing (GM) */

function schedulePublish(key, blob, metaRows) {
  clearTimeout(publishTimer);
  if ( !game.user.isGM || publishFailed ) return;
  publishTimer = setTimeout(async () => {
    publishTimer = 0;
    const scene = canvas.scene;
    if ( !S || !scene || S.baked?.key === key || shownKey !== key ) return;
    try {
      await save();
      const baked = await Store.publish(scene.id, key, blob, metaRows);
      S.baked = baked;
      await scene.update({ [`flags.${MODULE_ID}.${Model.FLAG}.baked`]: baked });
      tell("status");
    } catch ( err ) {
      publishFailed = true;
      console.warn(`${MODULE_ID} | could not publish the destruction`, err);
      ui.notifications.warn(game.i18n.localize("MOINENMAPS.Destr.publishFailed"));
    }
  }, 2500);
}

/* ---------------------------------------------------------------- editing (GM) */

export function ensureState() {
  if ( !S ) { S = Model.blank(); playedBlast = null; tell("loaded"); }
  return S;
}

/** The mask changed inside `box` (mask pixels): the pieces there break when the new bake shows. */
export function edited(box) {
  if ( !S ) return;
  S.rev = Model.nextRev();
  if ( box ) pendingBox = union(pendingBox, artBox(box));
  scheduleBake(); scheduleSave();
  tell("edited");
}

export function setParams(patch) {
  if ( !game.user.isGM ) return;
  const before = S?.params ?? Model.PARAM_DEFAULTS;
  const next = Model.cleanParams({ ...before, ...patch });
  // nothing really changed (a control echoing the stored value): no state, no bake, no save, no hook
  const changed = Object.keys(patch).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(before[k]));
  if ( !changed.length ) return;
  if ( !S ) ensureState();
  S.params = next;
  const live = changed.every((k) => ["anim", "idle", "fxWho"].includes(k));
  if ( live ) display?.setIdle(S.params.idle, S.params.fxWho); else scheduleBake(200);
  scheduleSave(); tell("params");
}

export function newVariation() {
  if ( !S ) return;
  S.seed = 1 + Math.floor(Math.random() * 99998);
  pendingBox = { x0: 0, y0: 0, x1: S.aw, y1: S.ah };
  scheduleBake(50); scheduleSave(); tell("params");
}

export function setEnabled(on) {
  if ( !game.user.isGM || (S ? S.enabled : true) === !!on ) return;
  if ( !S ) ensureState();
  S.enabled = !!on;
  if ( on ) rebake(); else { gen++; display?.clear(); shownKey = ""; }
  scheduleSave(); tell("params");
}

export function clearAll() {
  if ( !S ) return;
  S.mask.fill(0);
  edited(null);
  Editor.refreshOverlay();
}

/** Everyone sees every piece break again, at the same moment. */
export async function detonate() {
  if ( !S || !game.user.isGM ) return;
  S.blast = { id: foundry.utils.randomID(), t: game.time.serverTime + 350, box: null };
  await save();
  maybePlay();
}

function scheduleSave(ms = 700) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = 0; save(); }, ms);
}

export async function save() {
  if ( !S || !game.user.isGM || !canvas.scene ) return;
  clearTimeout(saveTimer); saveTimer = 0;
  await canvas.scene.update({ [`flags.${MODULE_ID}.${Model.FLAG}`]: Model.encode(S) });
}

/* ---------------------------------------------------------------- API */

export const destructionApi = {
  /** Switch the GM's tool: "paint" | "erase" | null. */
  activate: (m = "paint") => Editor.setMode(m),
  deactivate: () => Editor.setMode(null),
  mode: () => Editor.getMode(),
  brush: () => Editor.brush(),
  setBrush: async ({ size, level, type } = {}) => {
    if ( size !== undefined ) await game.settings.set(MODULE_ID, "destrBrush", size);
    if ( level !== undefined ) await game.settings.set(MODULE_ID, "destrLevel", level);
    if ( type !== undefined ) await game.settings.set(MODULE_ID, "destrType", typeof type === "string" ? Model.TYPES.indexOf(type) : type);
  },
  /** Paint a disc from a macro (scene coordinates, radius in scene pixels). */
  paint(x, y, radius, { level = 3, type = "blast", erase = false } = {}) {
    if ( !game.user.isGM ) return false;
    const s = ensureState();
    const box = Model.stamp(s, x, y, radius, { mode: erase ? "erase" : "raise", level, type: typeof type === "string" ? Math.max(0, Model.TYPES.indexOf(type)) : type });
    if ( box ) { edited(box); Editor.refreshOverlay(); }
    return !!box;
  },
  setParams, newVariation, setEnabled, clear: clearAll, detonate, save,
  /** Bake again; `{ force: true }` ignores the cache and the published file (determinism check). */
  rebake: ({ force = false } = {}) => rebake({ awaitPublish: false, force }),
  state: () => S ? Model.encode(S) : null,
  status: () => ({ ...status, key: shownKey, baked: S?.baked ?? null }),
  /** The break, replayed locally (all pieces). */
  replay: () => display?.play(null),
  display: () => display,
  TYPES: Model.TYPES, MATERIALS: Model.MATERIALS
};

export function registerDestruction() {
  moduleApi.destruction = destructionApi;
  Editor.bindHost({ state: () => S, ensureState, edited });
  Hooks.once("init", () => Editor.registerEditorSettings(() => tell("brush")));
  Hooks.on("canvasReady", onCanvasReady);
  Hooks.on("canvasTearDown", teardown);
  Hooks.on("updateScene", onUpdateScene);
  Hooks.once("ready", () => { const m = game.modules.get(MODULE_ID); if ( m ) { m.api ??= moduleApi; m.api.destruction ??= destructionApi; } });
  window.addEventListener("beforeunload", () => disposeBaker());
}
