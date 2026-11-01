import { MODULE_ID } from "../config.mjs";
import { api as moduleApi } from "../attrs.mjs";
import * as Model from "./model.mjs";
import { readMeta, LIVE_PARAMS } from "./core.mjs";
import { runBake, encodeInWorker, disposeBaker } from "./bake.mjs";
import { sceneMap, backgroundInfo, forgetSceneMap } from "./source.mjs";
import * as Store from "./store.mjs";
import { DestructionDisplay } from "./display.mjs";
import * as Editor from "./editor.mjs";

/**
 * The destruction of the open scene: loads the mask from the scene flag, bakes it (worker) or takes a cached or published bake,
 * shows it, plays the entry of what is new, and takes the GM's edits.
 *
 * One bake at a time: an edit during a bake marks the state dirty and the next bake starts when this one is on screen, so every
 * result shown is newer than the one before (no stale bake can replace a newer one) and no bake is thrown away. The worker keeps the
 * areas it baked, so a stroke only bakes the areas it touched; the display only adds and removes the areas whose hash changed.
 * The GM shows the raw bake at once; the PNG (for the IndexedDB cache and the players) is encoded in the worker a moment after the
 * last edit, uploaded and named in the scene flag together with the ENTRIES: which areas appeared and when (server time), so players
 * present play the same entry at the same moment and a reload or a late bake never replays an old one.
 * Public API: `game.modules.get("moinen-maps").api.destruction`. Hook fired: "moinenMapsDestruction" ("loaded" | "edited" |
 * "params" | "status" | "brush").
 */

let S = null, display = null, gen = 0, bakeTimer = 0, saveTimer = 0, persistTimer = 0, publishFailed = false;
let inflight = false, again = null, shownKey = "", shownMask = null, playedBlast = null, forceEntry = false, loaded = false, checkTimer = 0;
let strokes = [];                    // edits since the last bake started: { box (art px), a, b (art px) }
const played = new Set();            // area hashes already shown on this client (they never enter again)
const entryLog = new Map();          // GM: area hash -> { t (server time), o, d } of entries played here, for the flag
const ENTRY_WINDOW = 8000;           // an entry older than this (server time) is shown settled
const status = { baking: false, waiting: false, progress: 0, error: "", source: "", stats: null, hash: "", ms: 0, areas: [], perf: {} };

export const tell = (kind) => Hooks.callAll("moinenMapsDestruction", kind);
export const state = () => S;
export const getStatus = () => status;
const origin = () => { const r = Model.sceneRect(); return { x: r.x, y: r.y }; };
const fnv = (a, h = 2166136261) => { for ( let i = 0; i < a.length; i++ ) h = Math.imul(h ^ a[i], 16777619); return h >>> 0; };
const now = () => game.time.serverTime;

/* ---------------------------------------------------------------- lifecycle */

function onCanvasReady() {
  teardown();
  if ( !canvas.scene ) return;
  S = Model.load(canvas.scene);
  Editor.onCanvasReady();
  if ( S?.enabled && Model.hasPaint(S) ) rebake();
  selfCheck(10000);
  tell("loaded");
}

/**
 * Masks on the scene but nothing on screen a while after load: say why (console and the Damage panel) and bake here once more,
 * ignoring the cache and the published file.
 */
function selfCheck(ms, retried = false) {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(() => {
    checkTimer = 0;
    if ( !S || !S.enabled || !Model.hasPaint(S) || display?.groups.size ) return;
    if ( status.baking || status.waiting || inflight ) return selfCheck(4000, retried);
    const why = status.error || (shownKey ? "the bake had no areas" : "no bake reached the screen");
    console.error(`${MODULE_ID} | destruction: masks present but nothing displayed (${why})`);
    status.error = game.i18n.format("MOINENMAPS.Destr.notShown", { why }); tell("status");
    if ( !retried ) { shownKey = ""; rebake({ awaitPublish: false, force: true }).then(() => selfCheck(6000, true)); }
  }, ms);
}

function teardown() {
  gen++;
  for ( const t of [bakeTimer, saveTimer, persistTimer, checkTimer] ) clearTimeout(t);
  bakeTimer = saveTimer = persistTimer = 0;
  Editor.teardown();
  display?.destroy(); display = null;
  S = null; shownKey = ""; shownMask = null; strokes = []; again = null; forceEntry = false;
  played.clear(); entryLog.clear(); playedBlast = null; loaded = false;
  forgetSceneMap();
  disposeBaker();
  Object.assign(status, { baking: false, waiting: false, progress: 0, error: "", source: "", stats: null, hash: "", areas: [] });
}

function onUpdateScene(scene, changed, _options, userId) {
  if ( scene.id !== canvas.scene?.id ) return;
  const f = changed.flags?.[MODULE_ID];
  if ( !f || !(Model.FLAG in f || `-=${Model.FLAG}` in f) ) return;
  if ( userId === game.user.id ) return;                    // our own save: already shown
  S = Model.load(scene);
  if ( !S ) { display?.clear(); shownKey = ""; tell("loaded"); return; }
  display?.setLook(lookOf(S.params)); display?.setIdle(S.params.idle, S.params.fxWho);
  if ( S.enabled && Model.hasPaint(S) ) rebake(); else { gen++; display?.clear(); shownKey = ""; }
  Editor.refreshOverlay();
  tell("loaded");
}

const lookOf = (P) => ({ entry: P.entry && P.anim, speed: P.entrySpeed, power: P.entryPower });
const union = (a, b) => !a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
/** Mask box -> art box (a little wider: shards near the edge of a stroke move too). */
const artBox = (b) => b && { x0: b.x0 * Model.K - 3, y0: b.y0 * Model.K - 3, x1: (b.x1 + 1) * Model.K + 3, y1: (b.y1 + 1) * Model.K + 3 };
const toArt = (p) => { const r = Model.sceneRect(); return [(p.x - r.x) / S.ap, (p.y - r.y) / S.ap]; };

/* ---------------------------------------------------------------- baking */

function scheduleBake(ms = 120) {
  clearTimeout(bakeTimer);
  bakeTimer = setTimeout(() => { bakeTimer = 0; rebake(); }, ms);
}

/** `force`: bake here even when a cached or published bake exists (a check that the bake is deterministic). */
export async function rebake(opts = {}) {
  if ( !S ) return;
  clearTimeout(bakeTimer); bakeTimer = 0;
  if ( inflight ) { again = { ...(again ?? {}), ...opts }; return; }
  inflight = true; again = null;
  try { await bakeOnce(opts); }
  catch ( err ) { console.error(`${MODULE_ID} | destruction`, err); }
  finally { inflight = false; }
  if ( again && S ) { const o = again; again = null; rebake(o); }
}

async function bakeOnce({ awaitPublish = true, force = false } = {}) {
  const my = gen, scene = canvas.scene, T = { t0: performance.now() };
  if ( !Model.hasPaint(S) || !S.enabled ) {
    display?.clear(); shownKey = ""; shownMask = null;
    Object.assign(status, { baking: false, waiting: false, progress: 0, areas: [] }); tell("status"); return;
  }
  const key = Store.makeKey(scene, S, backgroundInfo()?.path ?? "");
  const taken = strokes.splice(0), mask = S.mask.slice();
  if ( key === shownKey && display && !force ) { maybeBlast(); return; }
  let sheet = null, metaRows = 0, source = "", blob = null, stats = null;
  const hit = force ? null : await Store.getCached(key);
  if ( my !== gen ) return;
  if ( hit?.blob ) { blob = hit.blob; metaRows = hit.metaRows; stats = hit.stats ?? null; source = "cache"; }
  if ( !blob && !force && S.baked?.key === key ) {
    blob = await Store.fetchPublished(S.baked);
    if ( my !== gen ) return;
    if ( blob ) { metaRows = S.baked.metaRows; source = "published"; Store.putCached(key, { blob, metaRows }); }
  }
  if ( blob ) {
    const t = performance.now();
    const dec = await Store.decodeSheet(blob);
    if ( my !== gen ) return;
    sheet = { data: dec.rgba, w: dec.w, h: dec.h }; T.decode = performance.now() - t;
  }
  // a player whose GM is painting: wait for the GM's upload, bake here only when it does not come
  if ( !sheet && awaitPublish && !game.user.isGM && game.users.activeGM ) {
    strokes.unshift(...taken);
    status.waiting = true; tell("status");
    bakeTimer = setTimeout(() => { bakeTimer = 0; rebake({ awaitPublish: false }); }, 12000);
    return;
  }
  status.waiting = false;
  if ( !sheet ) {
    Object.assign(status, { baking: true, progress: 0, error: "" }); tell("status");
    try {
      const t = performance.now();
      const input = { mask, mw: S.mw, mh: S.mh, K: Model.K, aw: S.aw, ah: S.ah, seed: S.seed, params: S.params };
      const res = await runBake(input, () => { const t1 = performance.now(); const m = sceneMap(S); T.map = (T.map ?? 0) + performance.now() - t1; return m; },
        { onProgress: (p) => { if ( my === gen ) { status.progress = p; tell("status"); } } });
      if ( my !== gen ) return;
      sheet = res.sheet; metaRows = res.metaRows; stats = res.stats; source = "baked";
      T.bake = performance.now() - t; status.ms = Math.round(T.bake);
    } catch ( err ) {
      if ( my !== gen ) return;
      console.error(`${MODULE_ID} | destruction bake`, err);
      Object.assign(status, { baking: false, error: String(err?.message ?? err) }); tell("status");
      return;
    }
  }
  let t = performance.now();
  const meta = readMeta(sheet.data, sheet.w, sheet.h, metaRows);
  display ??= new DestructionDisplay();
  display.setIdle(S.params.idle, S.params.fxWho); display.setLook(lookOf(S.params));
  const first = !loaded;
  const { added, removed } = display.sync(sheet.data, sheet.w, sheet.h, meta, S.ap, origin());
  T.show = performance.now() - t;
  playEntries(added, removed, taken, mask, first);
  shownKey = key; shownMask = mask; loaded = true;
  t = performance.now();
  const hash = fnv(sheet.data).toString(16);
  T.hash = performance.now() - t; T.total = performance.now() - T.t0;
  Object.assign(status, { baking: false, progress: 1, source, hash, error: "", stats: stats ?? status.stats, perf: Object.fromEntries(Object.entries(T).filter(([k]) => k !== "t0").map(([k, v]) => [k, Math.round(v * 10) / 10])),
    areas: display.areas.map((a) => ({ type: a.type, mat: Model.MATERIALS[a.mat + 1] ?? "earth", hash: a.hash })) });
  tell("status");
  if ( source === "baked" ) schedulePersist(key, sheet, metaRows, stats);
  else if ( game.user.isGM && S.baked?.key !== key && blob ) schedulePersist(key, null, metaRows, stats, blob);
  maybeBlast(first);
}

/**
 * Which new areas enter, and how. A new area under the GM's stroke enters from the stroke's start (gashes along it); an area that
 * replaced an older one (a stroke grew it) only reveals the changed part and fades the rest over. On load, or for a player, the
 * entries come from the scene flag (server time): recent ones play, older ones are shown settled. Areas this client has shown before
 * never enter again.
 */
function playEntries(added, removed, taken, mask, first) {
  if ( !display ) return;
  const all = forceEntry; forceEntry = false;
  // the edits this bake covers: the GM's strokes, or (a player, a reload) the difference to what was on screen
  let edits = taken;
  if ( !edits.length && shownMask && shownMask.length === mask.length ) {
    const b = Model.diffBox(shownMask, mask, S.mw);
    if ( b ) { const ab = artBox(b); edits = [{ box: ab, a: [(ab.x0 + ab.x1) / 2, (ab.y0 + ab.y1) / 2], b: null }]; }
  }
  const flag = new Map((S.entries ?? []).map((e) => [e.h, e]));
  const sNow = now(), pNow = performance.now();
  for ( const g of added ) {
    const h = g.hash, r = g.info.rect;
    if ( played.has(h) && !all ) continue;
    played.add(h);
    const e = flag.get(h);
    if ( e && (first || !game.user.isGM) ) {
      // from the flag: the same moment for everyone who is here; a late arrival still sees it whole, an old one stays settled
      if ( sNow - e.t > ENTRY_WINDOW ) continue;
      display.enter(g, { start: pNow + Math.max(0, e.t - sNow), o: e.o ?? null, dir: e.d ?? null, box: e.b ?? null, fadeRest: !!e.b });
      continue;
    }
    if ( first && !all ) continue;
    const hits = edits.filter((s) => s.box.x0 <= r.x1 && s.box.x1 >= r.x0 && s.box.y0 <= r.y1 && s.box.y1 >= r.y0);
    if ( !hits.length && !all ) continue;
    const replaced = removed.some((q) => { const o = q.info.rect; return o.x0 < r.x1 && o.x1 > r.x0 && o.y0 < r.y1 && o.y1 > r.y0; });
    const box = replaced && !all ? hits.reduce((u, s) => union(u, s.box), null) : null;
    const s0 = hits[0], o = all ? null : s0?.a ?? null;
    const d = s0?.b ? [s0.b[0] - s0.a[0], s0.b[1] - s0.a[1]] : null;
    display.enter(g, { start: pNow, o, dir: g.info.type === "gash" || S.params.directional ? d : null, box, fadeRest: !!box });
    if ( game.user.isGM ) entryLog.set(h, { h, o: o && o.map((v) => Math.round(v)), d: d && d.map((v) => Math.round(v * 100) / 100), b: box });
  }
}

/** After a bake is on screen: a detonation that has not been seen here yet. */
function maybeBlast(first = false) {
  if ( !display || !S ) return;
  const b = S.blast;
  if ( !b?.id || b.id === playedBlast ) return;
  playedBlast = b.id;
  const late = now() - b.t;
  if ( S.params.anim && late < (first ? 4000 : 15000) ) display.detonate(performance.now() - late);   // the shared moment (in the future, or already running)
}

/* ---------------------------------------------------------------- the PNG: cache, publish (GM) */

/**
 * A moment after the last bake on screen: the PNG (encoded in the worker), into the IndexedDB cache, and (GM) uploaded and named in
 * the scene flag with the entries that played since.
 */
function schedulePersist(key, sheet, metaRows, stats, blob = null) {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    persistTimer = 0;
    const my = gen, scene = canvas.scene;
    if ( !S || shownKey !== key ) return;
    try {
      if ( !blob ) {
        const t = performance.now();
        const png = await encodeInWorker(sheet.w, sheet.h, sheet.data);
        status.perf.encode = Math.round(performance.now() - t);
        blob = new Blob([png], { type: "image/png" });
        await Store.putCached(key, { blob, metaRows, stats });
      }
      if ( my !== gen || !S || shownKey !== key || !game.user.isGM || publishFailed || S.baked?.key === key ) return;
      await save();
      const baked = await Store.publish(scene.id, key, blob, metaRows);
      if ( my !== gen || !S ) return;
      S.baked = baked;
      // the entries that played since: everybody here plays them a moment after the upload, at the same server time
      const at = now() + 700, keep = new Set(display?.groups.keys() ?? []);
      for ( const e of entryLog.values() ) if ( !e.t ) e.t = at;
      for ( const [h, e] of entryLog ) if ( !keep.has(h) || at - e.t > 60000 ) entryLog.delete(h);
      S.entries = [...entryLog.values()];
      await scene.update({ [`flags.${MODULE_ID}.${Model.FLAG}.baked`]: baked, [`flags.${MODULE_ID}.${Model.FLAG}.entries`]: S.entries });
      tell("status");
    } catch ( err ) {
      if ( game.user.isGM ) {
        publishFailed = true;
        console.warn(`${MODULE_ID} | could not publish the destruction`, err);
        ui.notifications.warn(game.i18n.localize("MOINENMAPS.Destr.publishFailed"));
      } else console.warn(`${MODULE_ID} | destruction cache`, err);
    }
  }, 900);
}

/* ---------------------------------------------------------------- editing (GM) */

export function ensureState() {
  if ( !S ) { S = Model.blank(); playedBlast = null; tell("loaded"); }
  return S;
}

/** The mask changed inside `box` (mask pixels); `stroke` { a, b } (scene points) where it started and ended. */
export function edited(box, stroke = null) {
  if ( !S ) return;
  S.rev = Model.nextRev();
  if ( box ) {
    const ab = artBox(box);
    const a = stroke?.a ? toArt(stroke.a) : [(ab.x0 + ab.x1) / 2, (ab.y0 + ab.y1) / 2];
    strokes.push({ box: ab, a, b: stroke?.b ? toArt(stroke.b) : null });
  }
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
  const live = changed.every((k) => LIVE_PARAMS.has(k));
  display?.setIdle(S.params.idle, S.params.fxWho); display?.setLook(lookOf(S.params));
  if ( !live ) scheduleBake(200);
  scheduleSave(); tell("params");
}

export function newVariation() {
  if ( !S ) return;
  S.seed = 1 + Math.floor(Math.random() * 99998);
  forceEntry = true;
  scheduleBake(50); scheduleSave(); tell("params");
}

export function setEnabled(on) {
  if ( !game.user.isGM || (S ? S.enabled : true) === !!on ) return;
  if ( !S ) ensureState();
  S.enabled = !!on;
  if ( on ) rebake(); else { gen++; display?.clear(); shownKey = ""; shownMask = null; }
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
  S.blast = { id: foundry.utils.randomID(), t: now() + 350, box: null };
  await save();
  maybeBlast();
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
    if ( box ) { edited(box, { a: { x, y }, b: null }); Editor.refreshOverlay(); }
    return !!box;
  },
  setParams, newVariation, setEnabled, clear: clearAll, detonate, save,
  /** Bake again; `{ force: true }` ignores the cache and the published file (determinism check). */
  rebake: ({ force = false } = {}) => rebake({ awaitPublish: false, force }),
  state: () => S ? Model.encode(S) : null,
  status: () => ({ ...status, key: shownKey, baked: S?.baked ?? null, inflight }),
  /** Every area enters again, locally. */
  replay: () => display?.detonate(performance.now()),
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
