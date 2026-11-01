import { MODULE_ID } from "../config.mjs";
import { api as moduleApi } from "../attrs.mjs";
import * as Model from "./model.mjs";
import { readMeta, LIVE_PARAMS, META_FIELDS } from "./core.mjs";
import { runBake, disposeBaker } from "./bake.mjs";
import * as Net from "../net/stream.mjs";
import * as Chunks from "../net/chunks.mjs";
import { seedKnown } from "../water/publish.mjs";
import { sceneMap, backgroundInfo, forgetSceneMap } from "./source.mjs";
import * as Store from "./store.mjs";
import { setChanged, syncMap } from "../flag-diff.mjs";
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

let S = null, display = null, gen = 0, bakeTimer = 0, saveTimer = 0, persistTimer = 0;
let lastRecs = null;                // the strokes on screen (their hash is computed only when asked: 4 MB of FNV costs ~20 ms)
/*
 * STROKE RECORDS: what one stroke looks like (its sprites), from its chunk (memory, IndexedDB, the server) or baked here, keyed by
 * `<base>|<stroke id>|<signature>`: valid as long as the settings and the stroke itself are unchanged. The display gets a sheet
 * assembled from them, so the GM and every player show the same pixels whatever their source.
 */
const recs = new Map();
let shownRecs = new Map();           // stroke id -> record on screen (its older look stays until the new one is here)
const waitingSince = new Map();      // player: record key -> when its chunk was first missed (bake it here after AWAIT_CHUNK)
let netAbort = null, persisting = null, persistAgain = false;
const AWAIT_CHUNK = 12000;
let inflight = null, again = null, paramRev = 0, publishBackoff = 0, publishRetryAt = 0, editedHere = false, shownKey = "", shownMask = null, playedBlast = null, forceEntry = false, loaded = false, checkTimer = 0;
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
  S = Store.attachPaths(Model.load(canvas.scene), canvas.scene);
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
    if ( shownKey && status.stats?.areas === 0 ) return;   // only specks below the smallest area: nothing to show is right
    if ( status.baking || status.waiting || inflight ) return selfCheck(4000, retried);
    const why = status.error || (shownKey ? "the bake had no areas" : "no bake reached the screen");
    console.error(`${MODULE_ID} | destruction: masks present but nothing displayed (${why})`);
    status.error = game.i18n.format("MOINENMAPS.Destr.notShown", { why }); tell("status");
    if ( !retried ) { shownKey = ""; rebake({ awaitPublish: false, force: true }).then(() => selfCheck(6000, true)); }
  }, ms);
}

function teardown() {
  flushSave();
  gen++;
  for ( const t of [bakeTimer, saveTimer, persistTimer, checkTimer] ) clearTimeout(t);
  inflight = null; publishBackoff = 0; publishRetryAt = 0; editedHere = false;
  bakeTimer = saveTimer = persistTimer = 0;
  Editor.teardown();
  display?.destroy(); display = null;
  S = null; shownKey = ""; shownMask = null; strokes = []; again = null; forceEntry = false;
  played.clear(); entryLog.clear(); playedBlast = null; loaded = false; lastRecs = null;
  netAbort?.abort(); netAbort = null; recs.clear(); shownRecs = new Map(); waitingSince.clear(); persistAgain = false;
  forgetSceneMap();
  disposeBaker();
  Object.assign(status, { baking: false, waiting: false, progress: 0, error: "", source: "", stats: null, hash: "", areas: [] });
}

function onUpdateScene(scene, changed, _options, userId) {
  if ( scene.id !== canvas.scene?.id ) return;
  const f = changed.flags?.[MODULE_ID];
  // the main flag, a stroke (layout 3: one key per stroke) or a path changed (a deletion arrives under the key itself in v14)
  if ( !f || ![Model.FLAG, Model.OBJS, Store.PATHS].some((k) => k in f || `-=${k}` in f) ) return;
  if ( userId === game.user.id ) return;                    // our own save: already shown
  // another GM saved while this GM has strokes not saved yet: keep ours (our save follows and wins), never drop them
  if ( game.user.isGM && saveTimer ) return;
  S = Store.attachPaths(Model.load(scene), scene);
  if ( !S ) { gen++; display?.clear(); shownKey = ""; tell("loaded"); return; }
  display?.setLook(lookOf(S.params)); display?.setIdle(S.params.idle, S.params.fxWho);
  if ( S.enabled && Model.hasPaint(S) ) rebake(); else { gen++; display?.fadeAll(); shownKey = ""; }
  Editor.refreshOverlay();
  tell("loaded");
}

const lookOf = (P) => ({ entry: P.entry && P.anim, speed: P.entrySpeed, power: P.entryPower });
const union = (a, b) => !a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
/** Mask box -> art box (a little wider: shards near the edge of a stroke move too). */
const artBox = (b) => b && { x0: b.x0 * Model.K - 3, y0: b.y0 * Model.K - 3, x1: (b.x1 + 1) * Model.K + 3, y1: (b.y1 + 1) * Model.K + 3 };
/** A brush path thinned to a point every 6+ art px and at most 96 points (the flag stays small; the bake and entry read this). */
function simplify(pts) {
  const out = [pts[0]];
  for ( let i = 1; i < pts.length; i++ ) { const q = out[out.length - 1]; if ( Math.hypot(pts[i][0] - q[0], pts[i][1] - q[1]) >= 6 || i === pts.length - 1 ) out.push(pts[i]); }
  if ( out.length <= 96 ) return out;
  const step = (out.length - 1) / 95;
  return Array.from({ length: 96 }, (_, i) => out[Math.round(i * step)]);
}
/** A stroke's stored brush path as [[x, y, ms], ...] (art px). */
const unflat = (p) => { const out = []; for ( let i = 0; p && i + 2 < p.length; i += 3 ) out.push([p[i], p[i + 1], p[i + 2]]); return out; };
const pathOfObj = (id) => { const o = id && S?.objects?.find((q) => q.id === id); return o?.p ? unflat(o.p) : null; };
/** The stroke objects as the bake and the display take them (their level bytes decoded, their paths as pairs). */
const objectsIn = () => (S.objects ?? []).map((o) => ({ id: o.id, k: o.k, t: o.t, c: o.c | 0, x0: o.x0, y0: o.y0, w: o.w, h: o.h, bytes: Model.objBytes(o),
  path: o.p ? unflat(o.p).map(([x, y]) => [x, y]) : null }));
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
  const tok = inflight = {}; again = null;
  try { await bakeOnce(opts); }
  catch ( err ) { console.error(`${MODULE_ID} | destruction`, err); }
  finally { if ( inflight === tok ) inflight = null; }   // a teardown meanwhile already let it go
  if ( again && S ) { const o = again; again = null; rebake(o); }
}

async function bakeOnce({ awaitPublish = true, force = false } = {}) {
  const my = gen, scene = canvas.scene, T = { t0: performance.now() }, rev = paramRev;
  if ( !Model.hasPaint(S) || !S.enabled ) {
    display?.fadeAll(); shownKey = ""; shownMask = null;   // erased or cleared: the damage fades out, it does not vanish
    loaded = true;   // the scene's state is known: what is painted from now on is new and enters
    Object.assign(status, { baking: false, waiting: false, progress: 0, areas: [] }); tell("status"); return;
  }
  const bg = backgroundInfo()?.path ?? "";
  const key = Store.makeKey(scene, S, bg);
  const taken = strokes.splice(0), mask = S.mask.slice();
  if ( key === shownKey && display && !force ) { maybeBlast(); return; }
  const S0 = S, base = Store.baseKey(scene, S, bg), objs = objectsIn();
  // the strokes to show, each with the key of the record that shows it
  const want = [];
  S.objects.forEach((o, index) => { if ( !o.k ) { const sig = Store.objSig(S, o); want.push({ index, objId: o.id, sig, rk: `${base}|${o.id}|${sig}` }); } });
  if ( force ) for ( const w of want ) recs.delete(w.rk);
  const src = { mem: 0, chunk: 0, legacy: 0, baked: 0 };
  const firstLoad = !loaded;
  let first = firstLoad;
  /** Everything we have on screen now (a stroke without its record yet keeps its older look, or waits). */
  const show = () => {
    if ( my !== gen || S !== S0 ) return;
    const t = performance.now();
    showRecs(want, objs, taken, mask, first);
    first = false; loaded = true; shownMask = mask;
    T.show = (T.show ?? 0) + performance.now() - t;
  };
  const missing = () => want.filter((w) => !recs.has(w.rk));
  src.mem = want.length - missing().length;

  // 1. the GM's manifest: the chunks of strokes whose inputs are unchanged (IndexedDB first, then the server), shown as they land
  const M = force ? null : Store.manifestOf(S);
  const failed = [];
  if ( M && M.base === base ) {
    const fetch = [];
    for ( const w of missing() ) { const e = Store.entryOf(M, w.objId); if ( e?.sig === w.sig ) fetch.push({ ...w, id: e.id }); }
    if ( fetch.length ) {
      const t = performance.now();
      status.waiting = true; status.loading = fetch.length; tell("status");
      netAbort ??= new AbortController();
      let timer = 0;
      const soon = () => { if ( !timer ) timer = setTimeout(() => { timer = 0; show(); }, 60); };   // a few chunks landing together: one sync
      await Promise.all(prioritise(fetch, objs).map(async (w) => {
        const got = await Net.getChunk(M.dir, w.id, { prio: w.prio, signal: netAbort?.signal });
        if ( got?.sprites && got.F === META_FIELDS ) { recs.set(w.rk, { rk: w.rk, objId: w.objId, id: w.id, sprites: got.sprites }); src.chunk++; status.loading--; soon(); }
        else failed.push(w);
      }));
      clearTimeout(timer);
      T.fetch = performance.now() - t;
      if ( my !== gen ) return;
    }
  } else if ( !force && S.baked?.path && S.baked.key === key ) {
    // the first format: one sheet for the whole scene, read once and cut into strokes (the GM's next publish replaces it)
    const t = performance.now();
    const dec = await Store.fetchLegacy(S.baked);
    if ( my !== gen ) return;
    try {
      const meta = dec && readMeta(dec.rgba, dec.w, dec.h, S.baked.metaRows);
      const parts = meta ? Chunks.splitSheet(dec.rgba, dec.w, meta, META_FIELDS) : null;
      if ( parts ) for ( const w of missing() ) { recs.set(w.rk, { rk: w.rk, objId: w.objId, id: null, sprites: parts.get(w.index) ?? [] }); src.legacy++; }
    } catch ( err ) { console.warn(`${MODULE_ID} | destruction: unusable published file`, err); }
    T.decode = performance.now() - t;
  }
  if ( S !== S0 ) return;   // a newer state arrived meanwhile: the next pass (queued) shows it, with what landed here kept

  // 2. strokes nobody has published (yet): a player waits for the GM's chunk, per stroke, and bakes only what is still missing after
  // AWAIT_CHUNK; a chunk that was named but could not be had (gone, broken) is baked at once
  let toBake = missing();
  const broken = new Set(failed.map((w) => w.rk));
  if ( toBake.length && !force && awaitPublish && !game.user.isGM && game.users.activeGM ) {
    const t = Date.now();
    for ( const w of toBake ) if ( !waitingSince.has(w.rk) ) waitingSince.set(w.rk, t);
    const late = toBake.filter((w) => broken.has(w.rk) || t - waitingSince.get(w.rk) >= AWAIT_CHUNK);
    if ( late.length < toBake.length ) {
      const next = Math.min(...toBake.filter((w) => !late.includes(w)).map((w) => waitingSince.get(w.rk) + AWAIT_CHUNK)) - t;
      clearTimeout(bakeTimer);
      bakeTimer = setTimeout(() => { bakeTimer = 0; rebake(); }, Math.max(50, next));
    }
    toBake = late;
  }
  if ( toBake.length ) {
    Object.assign(status, { baking: true, progress: 0, error: "" }); tell("status");
    if ( src.chunk || src.legacy ) show();   // what just landed, while the rest bakes
    try {
      const t = performance.now(), need = new Set(toBake.map((w) => w.index));
      // only these strokes: the others are left out (an erase stroke is skipped by the bake), so their indices stay as they are
      const input = { objects: objs.map((o, i) => need.has(i) ? o : { ...o, k: 1 }), mw: S.mw, mh: S.mh, K: Model.K, aw: S.aw, ah: S.ah, seed: S.seed, params: S.params };
      const res = await runBake(input, () => { const t1 = performance.now(); const m = sceneMap(S); T.map = (T.map ?? 0) + performance.now() - t1; return m; },
        { onProgress: (p) => { if ( my === gen ) { status.progress = p; tell("status"); } } });
      if ( my !== gen ) return;
      const parts = Chunks.splitSheet(res.sheet.data, res.sheet.w, res.meta, META_FIELDS);
      for ( const w of toBake ) { recs.set(w.rk, { rk: w.rk, objId: w.objId, id: null, sprites: parts.get(w.index) ?? [] }); waitingSince.delete(w.rk); }
      src.baked = toBake.length;
      status.stats = res.stats;
      T.bake = performance.now() - t; status.ms = Math.round(T.bake);
    } catch ( err ) {
      if ( my !== gen ) return;
      console.error(`${MODULE_ID} | destruction bake`, err);
      Object.assign(status, { baking: false, error: String(err?.message ?? err) }); tell("status");
      return;
    }
    // a setting changed while this baked (clicking through toggles): the bake for the final state follows, this one is not shown
    if ( (rev !== paramRev || S !== S0) && !force ) { strokes.unshift(...taken); Object.assign(status, { baking: false }); tell("status"); if ( !bakeTimer ) again ??= {}; return; }
  }

  // 3. on screen: everything we have
  show();
  const complete = want.every((w) => recs.has(w.rk));
  if ( complete ) { shownKey = key; waitingSince.clear(); }
  // records no stroke uses any more (an older look, an undone stroke) are let go
  const live = new Set([...want.map((w) => w.rk), ...[...shownRecs.values()].map((r) => r.rk)]);
  for ( const k of recs.keys() ) if ( !live.has(k) ) recs.delete(k);
  T.total = performance.now() - T.t0;
  const source = Object.entries(src).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ") || "memory";
  Object.assign(status, { baking: false, waiting: !complete, loading: 0, progress: 1, source, hash: "", error: "", perf: Object.fromEntries(Object.entries(T).filter(([k]) => k !== "t0").map(([k, v]) => [k, Math.round(v * 10) / 10])) });
  tell("status");
  if ( game.user.isGM && complete ) schedulePersist(src.baked + src.legacy);
  maybeBlast(firstLoad);
}

/** Chunks to download, nearest first: the newest strokes (their entry is about to play), then by distance to the view. */
function prioritise(list, objs) {
  const r = Model.sceneRect(), mpx = S.ap * Model.K, c = canvas.stage?.pivot ?? { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  const newest = objs.length - 3;
  for ( const w of list ) {
    const o = objs[w.index];
    const d = Math.hypot(r.x + (o.x0 + o.w / 2) * mpx - c.x, r.y + (o.y0 + o.h / 2) * mpx - c.y);
    w.prio = (w.index >= newest ? 0 : 1e7) + d;
  }
  return list.sort((a, b) => a.prio - b.prio);
}

/**
 * The display gets one sheet assembled from the strokes' records, in stroke order. A stroke whose record is not here yet keeps the
 * look it had on screen (a setting changed: the new look replaces it when it lands) or is left out for now (a new stroke).
 */
function showRecs(want, objs, taken, mask, first) {
  const list = [], next = new Map();
  for ( const w of want ) {
    const r = recs.get(w.rk) ?? shownRecs.get(w.objId);
    if ( !r ) continue;
    list.push({ index: w.index, sprites: r.sprites });
    next.set(w.objId, r);
  }
  shownRecs = next;
  display ??= new DestructionDisplay();
  display.setIdle(S.params.idle, S.params.fxWho); display.setLook(lookOf(S.params));
  // the areas already on screen need no pixels (the display keeps them by hash)
  const sheet = Chunks.assembleSheet(list, META_FIELDS, (h) => display.groups.has(h));
  const { added, removed } = display.sync(sheet.data, sheet.w, sheet.h, sheet.meta, S.ap, origin(), objs);
  playEntries(added, removed, taken, mask, first);
  lastRecs = list;
  status.areas = display.order.map((g) => ({ type: g.info.type, mat: Model.MATERIALS[g.info.mat + 1] ?? "earth", hash: g.info.hash, cause: g.info.cause ?? 0, obj: g.objId ?? null }));
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
  const sNow = now(), pNow = performance.now(), dirOn = !!S.params.directional;
  const fresh = new Map(taken.filter((s) => s.id).map((s) => [s.id, s]));
  for ( const g of added ) {
    const h = g.hash;
    // the same stroke's older look (a setting changed) stays underneath until the new one is in (never a blank frame)
    const under = removed.filter((q) => q.objId && q.objId === g.objId);
    // shown here before (a look toggle switched back, an undo), or a new look of existing damage: no entry, a cross-fade
    if ( g.reused || (played.has(h) && !all) ) { played.add(h); display.swap(g, under); continue; }
    played.add(h);
    const e = flag.get(h);
    if ( e && (first || !game.user.isGM) ) {
      // from the flag: the same moment for everyone who is here; a late arrival still sees it whole, an old one stays settled
      if ( sNow - e.t > ENTRY_WINDOW ) { display.swap(g, under); continue; }
      display.enter(g, { start: pNow + Math.max(0, e.t - sNow), o: dirOn ? e.o ?? null : null, dir: dirOn ? e.d ?? null : null, under,
        path: dirOn ? pathOfObj(e.p) : null, spine: g.info.type === "gash" ? pathOfObj(g.objId) : null });
      continue;
    }
    if ( first && !taken.length && !all ) continue;   // what was already there when the scene opened
    // only a stroke painted just now enters; anything else (a setting changed, a new variation without Detonate) fades to its new look
    const s0 = all ? null : fresh.get(g.objId);
    if ( !s0 && !all ) { display.swap(g, under); continue; }
    // with "follows the stroke" off the entry is the plain radial one from the epicentre
    const o = s0 && dirOn ? s0.a ?? null : null;
    const d = dirOn && s0?.b ? [s0.b[0] - s0.a[0], s0.b[1] - s0.a[1]] : null;
    const path = s0 && dirOn ? s0.path : null;
    display.enter(g, { start: pNow, o, dir: d, under, path, spine: g.info.type === "gash" ? pathOfObj(g.objId) : null });
    if ( game.user.isGM ) entryLog.set(h, { h, o: o && o.map((v) => Math.round(v)), d: d && d.map((v) => Math.round(v * 100) / 100), b: null, p: path ? s0.id : null });
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

/* ---------------------------------------------------------------- publishing the chunks (GM) */

/**
 * A moment after a bake is on screen (sooner for a small edit): the strokes the manifest does not name yet are encoded in the codec
 * worker (in parallel with the next bake), uploaded (only what the server lacks, a few at a time) and named in the manifest together
 * with the entries that played since. One run at a time; a run asked for meanwhile follows it.
 */
function schedulePersist(fresh = 0) {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => { persistTimer = 0; persist(); }, Math.max(fresh <= 2 ? 300 : 900, publishRetryAt - Date.now()));
}

async function persist() {
  if ( persisting ) { persistAgain = true; return; }
  // one GM publishes: the one who painted here, or the active GM (two GMs never race on the files and the flag)
  if ( !S || !canvas.scene || !game.user.isGM || !(editedHere || game.users.activeGM?.isSelf) ) return;
  persisting = persistOnce().finally(() => { persisting = null; if ( persistAgain ) { persistAgain = false; schedulePersist(0); } });
  return persisting;
}

async function persistOnce() {
  const my = gen, scene = canvas.scene, bg = backgroundInfo()?.path ?? "";
  const base = Store.baseKey(scene, S, bg), key = Store.makeKey(scene, S, bg);
  if ( shownKey !== key ) return;                   // not all on screen yet: the bake that completes it asks again
  const M = Store.manifestOf(S), dir = Net.chunkDir(scene.id), same = M?.dir === dir && M.base === base;
  seedKnown(scene);
  const c = {}, todo = [];
  for ( const o of S.objects ) {
    if ( o.k ) continue;
    const sig = Store.objSig(S, o), r = recs.get(`${base}|${o.id}|${sig}`);
    if ( !r ) return;                                // should not happen once complete; a later run publishes
    const e = same ? Store.entryOf(M, o.id) : null;
    if ( e?.sig === sig ) c[o.id] = `${sig}:${e.id}`;
    else if ( r.id && Net.known(dir).has(r.id) ) c[o.id] = `${sig}:${r.id}`;
    else todo.push({ o, sig, r });
  }
  const stale = M ? Object.keys(M.c).filter((id) => !(id in c) && !todo.some((q) => q.o.id === id)) : [];
  if ( !todo.length && same && !stale.length && Object.keys(c).every((id) => M.c[id] === c[id]) && M.key === key ) return;
  try {
    if ( Date.now() < publishRetryAt ) { schedulePersist(0); return; }
    if ( todo.length ) {
      const t = performance.now();
      const out = await Net.job({ kind: "objects", F: META_FIELDS, objs: todo.map((q) => ({ key: q.o.id, sprites: q.r.sprites })) });
      status.perf.encode = Math.round(performance.now() - t);
      const byKey = new Map(out.map((e) => [e.key, e]));
      for ( const q of todo ) {
        const e = byKey.get(q.o.id);
        q.r.id = e.id;
        c[q.o.id] = `${q.sig}:${e.id}`;
        Net.keep(e.id, e.bytes, { F: META_FIELDS, sprites: q.r.sprites });
      }
      const t2 = performance.now();
      await Net.upload(dir, out.map((e) => ({ id: e.id, bytes: e.bytes })));
      status.perf.upload = Math.round(performance.now() - t2);
    }
    if ( my !== gen || !S ) return;
    await save();                                    // the strokes first, so the signatures mean the same to everyone
    const baked = { v: 2, dir, base, key, at: now(), c, path: null, metaRows: null };
    // the entries that played since: everybody here plays them a moment after the upload, at the same server time
    const at = now() + 700, keep = new Set(display?.groups.keys() ?? []);
    for ( const e of entryLog.values() ) if ( !e.t ) e.t = at;
    for ( const [h, e] of entryLog ) if ( !keep.has(h) || at - e.t > 60000 ) entryLog.delete(h);
    S.entries = [...entryLog.values()];
    // the manifest key by key: a new stroke adds one entry, an undo deletes one (flag-diff.mjs)
    const BK = `flags.${MODULE_ID}.${Model.FLAG}.baked`, stored = scene.flags?.[MODULE_ID]?.[Model.FLAG]?.baked;
    const upd = { [`flags.${MODULE_ID}.${Model.FLAG}.entries`]: S.entries };
    setChanged(upd, BK, stored, baked, ["v", "dir", "base", "key", "at", "path", "metaRows"]);
    syncMap(upd, `${BK}.c`, stored?.c, c);
    await scene.update(upd);
    if ( S ) S.baked = { ...baked, c };
    publishBackoff = 0; publishRetryAt = 0;
    Net.scheduleGc(scene.id);
    tell("status");
  } catch ( err ) {
    // try again later (15 s, 30 s, 1 min, ... 8 min); warn once
    if ( !publishBackoff ) ui.notifications.warn(game.i18n.localize("MOINENMAPS.Destr.publishFailed"));
    publishBackoff = Math.min(8 * 60000, publishBackoff ? publishBackoff * 2 : 15000);
    publishRetryAt = Date.now() + publishBackoff;
    console.warn(`${MODULE_ID} | could not publish the destruction (next try in ${publishBackoff / 1000} s)`, err);
    if ( my === gen ) schedulePersist(0);
  }
}

/* ---------------------------------------------------------------- editing (GM) */

export function ensureState() {
  if ( !S ) { S = Model.blank(); playedBlast = null; tell("loaded"); }
  return S;
}

/**
 * A stroke ended: `box` (mask pixels) and `stroke` { buf (levels on the whole mask grid), erase, type, a, b (scene points), path }.
 * It becomes a new stroke object at the top; nothing painted before it changes. Without `stroke.buf` (clear), only the bake follows.
 */
export function edited(box, stroke = null) {
  if ( !S ) return;
  S.rev = Model.nextRev();
  if ( box && stroke?.buf ) {
    const ab = artBox(box);
    const a = stroke.a ? toArt(stroke.a) : [(ab.x0 + ab.x1) / 2, (ab.y0 + ab.y1) / 2];
    // follows the stroke: the brush path is kept with the stroke (art px, ms since it began); the bake and the entry read it
    let path = null;
    // (a tear keeps it always: its brush path is the tear's spine)
    if ( (S.params.directional || Model.TYPES[stroke.type ?? 0] === "gash") && stroke.path?.length > 1 && !stroke.erase ) path = simplify(stroke.path.map(([x, y, t]) => { const [ax, ay] = toArt({ x, y }); return [Math.round(ax), Math.round(ay), Math.round(t)]; }));
    const id = foundry.utils.randomID(10);
    const ob = Model.makeObject(stroke.buf, S.mw, box, { id, erase: !!stroke.erase, type: stroke.type ?? 0, path: path?.flat() ?? null, cause: stroke.cause ?? 0 });
    ob.s = Model.nextSeq(S);                         // its place in the order (layout 3 stores the strokes key by key)
    S.objects = [...(S.objects ?? []), ob];
    Model.composite(S);
    strokes.push({ box: ab, a, b: stroke.b ? toArt(stroke.b) : null, path, id });
  }
  editedHere = true;
  scheduleBake(); scheduleSave();
  tell("edited");
}

/**
 * The cause of one stroke object (0: unspecified, it follows the scene default). Only that stroke bakes again (its hash holds its
 * cause); everything else stays exactly as it was. The new look fades over the old one.
 */
export function setObjectCause(id, cause) {
  if ( !S || !game.user.isGM ) return false;
  const i = (S.objects ?? []).findIndex((o) => o.id === id);
  if ( i < 0 || S.objects[i].k ) return false;
  const c = Model.causeOf(cause);
  if ( (S.objects[i].c | 0) === c ) return false;
  S.objects = S.objects.map((o, k) => k === i ? Model.withCause(o, c) : o);
  Model.composite(S);
  S.rev = Model.nextRev();
  editedHere = true;
  scheduleBake(60); scheduleSave();
  tell("edited");
  return true;
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
  if ( !live ) { paramRev++; scheduleBake(250); }
  scheduleSave(); tell("params");
}

export function newVariation() {
  if ( !S ) return;
  S.seed = 1 + Math.floor(Math.random() * 99998);
  forceEntry = true; paramRev++;
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
  S.objects = []; Model.composite(S);
  edited(null);
  Editor.refreshOverlay();
}

/** Undo: the last stroke object goes; everything painted before it stays exactly as it was. */
export function undoLast() {
  if ( !S?.objects?.length ) return false;
  S.objects = S.objects.slice(0, -1); Model.composite(S);
  edited(null);
  Editor.refreshOverlay();
  return true;
}

/** Everyone sees every piece break again, at the same moment. */
export async function detonate() {
  if ( !S || !game.user.isGM ) return;
  S.blast = { id: foundry.utils.randomID(), t: now() + 350, box: null };
  await save();
  maybeBlast();
}

let saveFor = null;                  // the scene a pending save belongs to
function scheduleSave(ms = 700) {
  clearTimeout(saveTimer);
  saveFor = canvas.scene;
  saveTimer = setTimeout(() => { saveTimer = 0; save(); }, ms);
}

/** A save still pending (a scene switch within the pause, the page going away): written now, to the scene it belongs to. */
function flushSave() {
  if ( !saveTimer || !S || !game.user.isGM || !saveFor ) return;
  clearTimeout(saveTimer); saveTimer = 0;
  const scene = saveFor, upd = Store.flagUpdate(S, scene);
  saveFor = null;
  if ( !Object.keys(upd).length ) return;
  scene.update(upd).catch((err) => console.warn(`${MODULE_ID} | destruction: could not save`, err));
}

export async function save() {
  if ( !S || !game.user.isGM || !canvas.scene ) return;
  clearTimeout(saveTimer); saveTimer = 0;
  const upd = Store.flagUpdate(S, canvas.scene);
  if ( Object.keys(upd).length ) await canvas.scene.update(upd);    // nothing changed: no write
}

/* ---------------------------------------------------------------- API */

export const destructionApi = {
  /** Switch the GM's tool: "paint" | "erase" | null. */
  activate: (m = "paint") => Editor.setMode(m),
  deactivate: () => Editor.setMode(null),
  mode: () => Editor.getMode(),
  brush: () => Editor.brush(),
  setBrush: async ({ size, level, type, cause } = {}) => {
    if ( size !== undefined ) await game.settings.set(MODULE_ID, "destrBrush", size);
    if ( level !== undefined ) await game.settings.set(MODULE_ID, "destrLevel", level);
    if ( type !== undefined ) await game.settings.set(MODULE_ID, "destrType", typeof type === "string" ? Model.TYPES.indexOf(type) : type);
    if ( cause !== undefined ) await game.settings.set(MODULE_ID, "destrCause", Model.causeOf(cause));
  },
  /** Paint a disc from a macro (scene coordinates, radius in scene pixels); `cause` a name or index (0 / omitted: the scene default). */
  paint(x, y, radius, { level = 3, type = "blast", erase = false, cause = 0 } = {}) {
    if ( !game.user.isGM ) return false;
    const s = ensureState();
    const t = typeof type === "string" ? Math.max(0, Model.TYPES.indexOf(type)) : type;
    const buf = { mask: new Uint8Array(s.mw * s.mh), mw: s.mw, mh: s.mh, mpx: s.mpx };
    const box = Model.stamp(buf, x, y, radius, { mode: "raise", level: erase ? 1 : level, type: t });
    if ( box ) { edited(box, { buf: buf.mask, erase, type: t, cause: Model.causeOf(cause), a: { x, y }, b: null }); Editor.refreshOverlay(); }
    return !!box;
  },
  /** The cause of a painted stroke (by its id; see state().o); only that stroke bakes again. */
  setCause: (id, cause) => setObjectCause(id, cause),
  setParams, newVariation, setEnabled, clear: clearAll, detonate, save,
  /** Bake again; `{ force: true }` ignores the cache and the published file (determinism check). */
  rebake: ({ force = false } = {}) => rebake({ awaitPublish: false, force }),
  state: () => S ? Model.encode(S) : null,
  status: () => { if ( lastRecs && !status.hash ) status.hash = Chunks.recordsHash(lastRecs); return { ...status, key: shownKey, baked: S?.baked ?? null, inflight }; },
  /** Streaming counters (requests, bytes, IndexedDB hits, uploads) and the chunk store's GC, for tests. */
  net: { stats: () => ({ ...Net.stats }), reset: Net.resetStats, debug: Net.debug, gc: (opts) => canvas.scene && Net.collectGarbage(canvas.scene.id, opts) },
  /** Every area enters again, locally. */
  replay: () => display?.detonate(performance.now()),
  display: () => display,
  TYPES: Model.TYPES, MATERIALS: Model.MATERIALS, CAUSES: Model.CAUSES
};

export function registerDestruction() {
  moduleApi.destruction = destructionApi;
  Editor.bindHost({ state: () => S, ensureState, edited, undo: undoLast });
  Hooks.once("init", () => Editor.registerEditorSettings(() => tell("brush")));
  Hooks.on("canvasReady", onCanvasReady);
  Hooks.on("canvasTearDown", teardown);
  Hooks.on("updateScene", onUpdateScene);
  Hooks.once("ready", () => { const m = game.modules.get(MODULE_ID); if ( m ) { m.api ??= moduleApi; m.api.destruction ??= destructionApi; } Store.dropOldCache(); });
  window.addEventListener("beforeunload", () => { flushSave(); disposeBaker(); });
  document.addEventListener("visibilitychange", () => { if ( document.visibilityState === "hidden" ) flushSave(); });
}
