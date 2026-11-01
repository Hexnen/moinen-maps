import { MODULE_ID } from "../config.mjs";
import { api as moduleApi } from "../attrs.mjs";
import * as Model from "./model.mjs";
import { readMeta, LIVE_PARAMS, META_FIELDS, CORE_VERSION } from "./core.mjs";
import { runBake, runBakePool, disposeBaker } from "./bake.mjs";
import * as Net from "../net/stream.mjs";
import * as Chunks from "../net/chunks.mjs";
import * as Trace from "../net/trace.mjs";
import * as Reveal from "../net/reveal.mjs";
import * as Policy from "./bake-policy.mjs";
import { perfLow } from "../perf-mode.mjs";
/** This client's loop breaker (bake-policy.mjs): the same strokes baked or published again and again stop it, with a reason. */
const breaker = new Policy.Breaker();
/** The last failed bake: { key, n, at } (its automatic retries back off). */
let bakeFail = null;
import { seedKnown } from "../water/publish.mjs";
import { sceneMap, backgroundInfo, forgetSceneMap } from "./source.mjs";
import * as Store from "./store.mjs";
import { setChanged, syncMap } from "../flag-diff.mjs";
import { DestructionDisplay } from "./display.mjs";
import * as Composite from "./composite.mjs";
import { cacheEnabled } from "./static-cache.mjs";
import * as Editor from "./editor.mjs";
import { sharedNow, ageOf } from "../shared-clock.mjs";

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
const plainRecs = new Map();         // `<base>|<stroke id>|<own signature>` -> its PLAIN look (baked from its own data alone: substrate.mjs)
const depOnly = new Set();           // strokes whose new record differs only by the strokes under them (substrate.mjs): silent swap
const depStats = { swaps: 0 };
let shownRecs = new Map();           // stroke id -> record on screen (its older look stays until the new one is here)
const staleRecs = new Map();         // stroke id -> its look from an older bake version (shown until its new record is in)
const waitingSince = new Map();      // player: record key -> when its chunk was first missed (bake it here after AWAIT_CHUNK)
let netAbort = null, persisting = null, persistAgain = false;
let reshow = null;                   // the latest pass's show(): records that got their pixels go on screen through it
let compositeShown = null;           // the settled composite the display draws its shells' bands from (composite.mjs)
let compositeTimer = 0, compositeTries = 0;
const AWAIT_CHUNK = 12000;
/** Strokes to bake on a scene load from which on the bake is spread over several workers and shown as it comes. */
const BIG_BAKE = 6;
/** Shells filled (their chunks' areas built) per step at first; the steps then adapt to what one cost (fill()). */
const FILL_STEP = 2;
// freshly computed stroke signatures are kept in IndexedDB (a moment later, off the pass) so the next load of this state reads them
Store.setSigsSink((key, out) => setTimeout(() => Net.putMeta(key, out), 1500));
/** Strokes put on screen per step of a scene load (a pause for the page between steps). */
const SHOW_BATCH = 12;
/** Strokes re-baked per idle pass in the background (a compatible older look being replaced). */
const IDLE_BATCH = 3;
let inflight = null, again = null, paramRev = 0, publishBackoff = 0, publishRetryAt = 0, editedHere = false, shownKey = "", shownMask = null, playedBlast = null, forceEntry = false, loaded = false, checkTimer = 0;
let strokes = [];                    // edits since the last bake started: { box (art px), a, b (art px) }
const played = new Set();            // area hashes already shown on this client (they never enter again)
const entryLog = new Map();          // GM: area hash -> { t (server time), o, d } of entries played here, for the flag
const ENTRY_WINDOW = 8000;           // an entry older than this (server time) is shown settled
const status = { baking: false, waiting: false, progress: 0, error: "", warning: "", source: "", stats: null, hash: "", ms: 0, areas: [], perf: {} };

export const tell = (kind) => Hooks.callAll("moinenMapsDestruction", kind);
export const state = () => S;
export const getStatus = () => status;
const origin = () => { const r = Model.sceneRect(); return { x: r.x, y: r.y }; };
const fnv = (a, h = 2166136261) => { for ( let i = 0; i < a.length; i++ ) h = Math.imul(h ^ a[i], 16777619); return h >>> 0; };
// the shared wall clock (ms since 1970, server's clock): game.time.serverTime is the world's UPTIME in v14, so a moment stored with it
// lay hours ahead after a relaunch and every entry waited hidden for it (the damage looked gone). Legacy / far-future moments: settled
const now = () => sharedNow();

/* ---------------------------------------------------------------- lifecycle */

function onCanvasReady() {
  teardown();
  if ( !canvas.scene ) return;
  S = Store.attachPaths(Model.load(canvas.scene), canvas.scene);
  integrity(canvas.scene);
  // the active GM copies paths kept only in destructionPaths into their strokes' own keys, once (an old-code tab cannot lose them then)
  if ( S && game.user.isGM && game.users.activeGM?.isSelf && Store.pathsOnlyApart(canvas.scene) ) {
    save().catch((err) => console.warn(`${MODULE_ID} | destruction: could not copy the paths into the stroke keys`, err));
  }
  Editor.onCanvasReady();
  if ( S?.enabled && Model.hasPaint(S) ) { Reveal.expect("destruction"); rebake(); }
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

/**
 * Strokes that seem to have gone, said in the Damage panel and the console (never fixed silently): the published manifest names
 * strokes the scene no longer holds (while there is paint and damage is on, every publish brings the manifest up to date, so a
 * lasting mismatch means strokes were dropped), a browser tab running the module from before layout 3 wrote the scene, or a save
 * dropped strokes nobody undid (Store.SNAPSHOT keeps them).
 */
function integrity(scene) {
  const F = scene?.flags?.[MODULE_ID] ?? {}, f = F[Model.FLAG], warn = [];
  if ( Model.mixedLayout(f, F[Model.OBJS]) ) warn.push(game.i18n.localize("MOINENMAPS.Destr.mixedLayout"));
  const M = S && Store.manifestOf(S), ids = new Set((S?.objects ?? []).map((o) => o.id));
  const gone = M && S.enabled && Model.hasPaint(S) ? Object.keys(M.c).filter((id) => !ids.has(id)) : [];
  if ( gone.length ) warn.push(game.i18n.format("MOINENMAPS.Destr.strokesGone", { n: gone.length, total: Object.keys(M.c).length }));
  // the snapshot taken before a save dropped strokes nobody undid: said while any of those strokes is still missing
  const B3 = F[Store.SNAPSHOT], lost = Array.isArray(B3?.gone) ? B3.gone.filter((id) => !ids.has(id)) : [];
  if ( lost.length ) warn.push(game.i18n.format("MOINENMAPS.Destr.snapshotKept", { n: lost.length, when: new Date(B3.at).toLocaleString() }));
  if ( warn.length && (F[Store.BACKUP] || B3) ) warn.push(game.i18n.localize("MOINENMAPS.Destr.backupHint"));
  status.warning = warn.join(" ");
  if ( warn.length ) console.warn(`${MODULE_ID} | destruction: ${status.warning}`, { gone });
}

function teardown() {
  flushSave();
  gen++;
  for ( const t of [bakeTimer, saveTimer, persistTimer, checkTimer, idleTimer, rebakeTimer] ) clearTimeout(t);
  rebakeQueue = []; status.rebake = null; status.olderLook = null;
  inflight = null; publishBackoff = 0; publishRetryAt = 0; editedHere = false;
  bakeTimer = saveTimer = persistTimer = 0;
  Editor.teardown();
  clearTimeout(compositeTimer); compositeTimer = 0; compositeTries = 0;
  if ( display?.composite ) { display.composite.destroy(); display.composite = null; }
  compositeShown?.destroy(); compositeShown = null; reshow = null;
  display?.destroy(); display = null;
  S = null; shownKey = ""; shownMask = null; strokes = []; again = null; forceEntry = false;
  played.clear(); entryLog.clear(); playedBlast = null; loaded = false; lastRecs = null;
  netAbort?.abort(); netAbort = null; recs.clear(); plainRecs.clear(); shownRecs = new Map(); staleRecs.clear(); waitingSince.clear(); persistAgain = false;
  forgetSceneMap();
  disposeBaker();
  Object.assign(status, { baking: false, waiting: false, progress: 0, error: "", warning: "", source: "", stats: null, hash: "", areas: [] });
}

function onUpdateScene(scene, changed, _options, userId) {
  if ( scene.id !== canvas.scene?.id ) return;
  const f = changed.flags?.[MODULE_ID];
  // the main flag, a stroke (layout 3: one key per stroke) or a path changed (a deletion arrives under the key itself in v14)
  if ( !f || ![Model.FLAG, Model.OBJS, Store.PATHS].some((k) => k in f || `-=${k}` in f) ) return;
  if ( userId === game.user.id ) return;                    // our own save: already shown
  // another GM saved while this GM has strokes not saved yet: keep ours (our save follows and wins), never drop them
  if ( game.user.isGM && saveTimer ) return;
  // only the manifest (and the entries that go with it) changed, while everything is on screen here and nothing waits for a chunk:
  // take them over, no bake pass (an echo of another client's publish must never start one)
  const d = f[Model.FLAG], manifestOnly = d && typeof d === "object" && !(Model.OBJS in f) && !(Store.PATHS in f) && !(`-=${Model.OBJS}` in f) && !(`-=${Store.PATHS}` in f)
    && Object.keys(d).every((k) => k === "baked" || k === "entries");
  if ( manifestOnly && S && shownKey && !status.waiting && !status.baking && !status.compat ) {
    const F = scene.flags?.[MODULE_ID]?.[Model.FLAG];
    S.baked = F?.baked ?? S.baked; S.entries = Array.isArray(F?.entries) ? F.entries : S.entries;
    Trace.event("remote-manifest", { base: S.baked?.base ?? null });
    tell("status");
    return;
  }
  Trace.event("remote-change", { keys: Object.keys(f), main: d && typeof d === "object" ? Object.keys(d) : null });
  S = Store.attachPaths(Model.load(scene), scene);
  integrity(scene);
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
  const tok = inflight = {}, g0 = gen; again = null;
  try { await bakeOnce(opts); }
  catch ( err ) { console.error(`${MODULE_ID} | destruction`, err); }
  finally {
    if ( inflight === tok ) inflight = null;   // a teardown meanwhile already let it go
    if ( gen === g0 ) Reveal.ready("destruction");   // whatever this pass managed (waiting, failed): never hold the reveal for more
    // the status never stays on "baking" after a pass ended (an early return, an error, a superseded state)
    if ( gen === g0 && status.baking && !inflight ) { status.baking = false; tell("status"); }
  }
  if ( again && S ) { const o = again; again = null; rebake(o); }
}

async function bakeOnce({ awaitPublish = true, force = false, idle = false, all = false, redo = null } = {}) {
  const my = gen, scene = canvas.scene, T = { t0: performance.now() }, rev = paramRev;
  if ( !Model.hasPaint(S) || !S.enabled ) {
    display?.fadeAll(); shownKey = ""; shownMask = null;   // erased or cleared: the damage fades out, it does not vanish
    loaded = true;   // the scene's state is known: what is painted from now on is new and enters
    Object.assign(status, { baking: false, waiting: false, progress: 0, areas: [] }); tell("status"); return;
  }
  // the strokes' signatures from the last load of this same state (IndexedDB): computing them cold held the page ~660 ms
  // (before anything is taken from the state: a change meanwhile simply runs this pass on the new state)
  // (else computed in the codec worker: off the page)
  if ( !Store.hasSigs(S) ) { await Store.warmSigs(S, Net.getMeta, (m) => Net.job(m)); if ( my !== gen || !S ) return; }
  const bg = backgroundInfo()?.path ?? "";
  const key = Store.makeKey(scene, S, bg);
  const taken = strokes.splice(0), mask = S.mask.slice();
  if ( key === shownKey && display && !force && !idle && !all && !redo?.length ) { maybeBlast(); return; }
  // (the base has no bake version: a published stroke stays valid whatever the code's version is - bake-policy.mjs, version pinning)
  const tStart = performance.now();
  const S0 = S, base = Store.baseKey(scene, S, bg), legacy = Store.legacyBaseKey(scene, S, bg), objs = objectsIn();
  slow("pass:keys+objects", tStart);
  Trace.markOnce("damage:start");
  // the strokes to show, each with the key of the record that shows it
  // (the FULL signature: its own inputs + a digest of the older strokes under it, substrate.mjs; `own` alone tells a dependent re-bake)
  const want = [], FS = Store.sigsOf(S);
  const rkOf = (index) => `${base}|${S.objects[index].id}|${FS[index].sig}`;
  S.objects.forEach((o, index) => { if ( !o.k ) { const sig = FS[index].sig; want.push({ index, objId: o.id, sig, own: FS[index].own, deps: FS[index].deps, rk: rkOf(index) }); } });
  if ( force ) for ( const w of want ) recs.delete(w.rk);
  // Rebake (all or one stroke): these strokes are baked again with the current code; their pinned look stays on screen meanwhile
  const redoSet = new Set(redo ?? []);
  for ( const w of want ) if ( redoSet.has(w.objId) ) recs.delete(w.rk);
  slow("pass:want", tStart);
  const src ={ mem: 0, chunk: 0, legacy: 0, baked: 0 };
  const firstLoad = !loaded;
  let first = firstLoad;
  /**
   * Everything we have on screen now (a stroke without its record yet keeps its older look, or waits). On a scene load the strokes go
   * in a few at a time, those nearest to the view first, with a pause for the page between (a big scene's whole set in one sync held
   * the page for a second); a call while one runs is folded into it.
   */
  let showing = null, showAgain = false, prepping = null;
  const showOnce = (list, allow = null) => {
    const t = performance.now();
    // after the scene's reveal (or without one) a stroke that comes in during the load fades in by itself (no pop, no entry)
    showRecs(list, objs, taken, mask, first, firstLoad && !Reveal.holding("destruction"), allow);
    first = false; loaded = true; shownMask = mask;
    T.show = (T.show ?? 0) + performance.now() - t;
    slow("showOnce", t, { n: list.length, allow: allow?.size ?? null });
  };
  const show = reshow = () => {
    if ( my !== gen || S !== S0 ) return Promise.resolve();
    if ( !firstLoad && !redoSet.size ) {
      // (records whose pixels were let go after they went on screen get them back first, when an area of theirs is not on screen)
      const dry = needPixels(want);
      if ( !dry.length ) { showOnce(want); return Promise.resolve(); }
      return Promise.all(dry.map(hydrate)).then(() => { if ( my === gen && S === S0 ) showOnce(want); });
    }
    if ( showing ) { showAgain = true; return showing; }
    showing = (async () => {
      do {
        showAgain = false;
        // new strokes and new looks replacing an older one (stale while revalidate), nearest first, a batch per step; the others keep
        // what they show
        const best = (w) => recs.get(w.rk) ?? staleRecs.get(w.objId);
        // (the composite's shells all at once: its bands only match with every one of them in)
        const near = prioritise(want.filter((w) => best(w) && !best(w).shell && shownRecs.get(w.objId) !== best(w)).map((w) => ({ ...w })), objs);
        const allow = new Set(want.filter((w) => best(w) && (best(w).shell || shownRecs.get(w.objId) === best(w))).map((w) => w.objId));
        // (a background Rebake swaps a few strokes per step: each sync stays short while the scene is in use)
        const step = firstLoad ? SHOW_BATCH : 4;
        for ( let i = 0; i < near.length || i === 0; i += step ) {
          for ( const w of near.slice(i, i + step) ) allow.add(w.objId);
          const dry = needPixels(want);
          if ( dry.length ) { await Promise.all(dry.map(hydrate)); if ( my !== gen || S !== S0 ) return; }
          showOnce(want, allow);
          // every stroke in view is on screen (hidden): the reveal can come now; the strokes off screen follow unseen
          if ( !prepping && Reveal.holding("destruction") && want.every((w) => shownRecs.has(w.objId) || !inView(objs[w.index])) ) prepping = prepareReveal(my);
          if ( i + step < near.length ) { await new Promise((r) => setTimeout(r, firstLoad ? 0 : 16)); if ( my !== gen || S !== S0 ) return; }
        }
      } while ( showAgain && my === gen && S === S0 );
    })().finally(() => { showing = null; });
    return showing;
  };
  const missing = () => want.filter((w) => !recs.has(w.rk));
  // a scene load: as soon as every stroke in view has its record, those go on screen (hidden) and the reveal is prepared; the rest
  // keeps coming and is added unseen (off screen) or with its own short fade
  let earlyDone = false;
  const early = () => {
    if ( earlyDone || !firstLoad || !Reveal.holding("destruction") ) return;
    if ( !want.every((w) => recs.has(w.rk) || staleRecs.has(w.objId) || shownRecs.has(w.objId) || !inView(objs[w.index])) ) return;
    earlyDone = true; Trace.markOnce("damage:inView");
    show();
  };
  src.mem = want.length - missing().length;

  // 0. SETTLED COMPOSITE (composite.mjs): on a scene load, the strokes the GM's composite holds (the same signatures, the scene's
  // strokes being those plus newer ones on top) are shown from its tiles as shells; their own chunks come only when needed
  const M = force ? null : Store.manifestOf(S);
  if ( firstLoad && !force && !all ) {
    const t = performance.now(), got = await compositeLoad(scene, base, want, M);
    if ( my !== gen ) return;
    if ( got ) { src.composite = got; T.composite = performance.now() - t; early(); }
  }
  // anything but new strokes on top of the shells (an undo, a changed stroke, a setting): every shell gets its pixels first, so the
  // change is drawn from real areas (the composite has no picture of the scene without them)
  else if ( shellRecs().length && (force || all || [...shownRecs.values()].some((r) => r.shell && !want.some((w) => w.rk === r.rk))) ) {
    await hydrateShells("change");
    if ( my !== gen || S !== S0 ) return;
  }

  // 1. the GM's manifest: the chunks of strokes whose inputs are unchanged (IndexedDB first, then the server), shown as they land
  const failed = [];
  // a manifest of a NEWER bake version (a client with newer code published it) is used as it is: never baked again here for it,
  // never overwritten (bake-policy.mjs) - an older client re-baking and re-publishing it is how two tabs took turns for ever
  const rule = force ? "none" : Store.sameBase(M?.base, base, legacy) ? "same" : Policy.manifestRule(M?.base, base);
  status.newerManifest = rule === "newer";
  if ( rule === "newer" ) { Trace.event("manifest-newer", { manifest: M.base, mine: base }); }
  if ( M && (rule === "same" || rule === "newer") ) {
    const fetch = [];
    for ( const w of missing() ) { const e = Store.entryOf(M, w.objId); if ( e?.sig === w.sig && !redoSet.has(w.objId) ) fetch.push({ ...w, id: e.id, ver: e.ver }); }
    if ( fetch.length ) {
      const t = performance.now();
      status.waiting = true; status.loading = fetch.length; tell("status");
      netAbort ??= new AbortController();
      let timer = 0;
      // a few chunks landing together: one sync; while the scene's reveal is held back nothing is shown piece by piece (all of it goes
      // on screen at once below); if the reveal comes first (its budget ran out), what is here shows then and the rest as it lands
      const soon = () => { if ( !timer && !Reveal.holding("destruction") ) timer = setTimeout(() => { timer = 0; show(); }, 60); };
      Reveal.whenRevealed(() => { if ( status.loading > 0 ) soon(); });
      // many chunks (a cold browser, a slow line): the reveal does not wait for all of them (see the big bake below)
      if ( firstLoad && fetch.length >= 20 ) Reveal.progressive("destruction", 1500);
      await Promise.all(prioritise(fetch, objs).map(async (w) => {
        const got = await Net.getChunk(M.dir, w.id, { prio: w.prio, signal: netAbort?.signal });
        if ( got?.sprites && got.F === META_FIELDS ) { recs.set(w.rk, { rk: w.rk, objId: w.objId, own: w.own, id: w.id, ver: w.ver, dir: M.dir, sprites: got.sprites }); src.chunk++; status.loading--; soon(); early(); }
        else failed.push(w);
      }));
      clearTimeout(timer);
      T.fetch = performance.now() - t;
      if ( my !== gen ) return;
    }
  } else if ( M && Store.staleOk(M.base, base) ) {
    // STALE WHILE REVALIDATE: the manifest is of an older bake version (same settings, map and grid, a version whose pixels are still
    // a faithful picture of the same strokes): its chunks are shown at once as the strokes' "older look" and the new bake replaces
    // them stroke by stroke with a short cross-fade - never a scene without its damage while the new bake runs
    const old = [];
    for ( const w of missing() ) { const e = Store.entryOf(M, w.objId); if ( (e?.sig === w.sig || e?.sig === w.own) && !shownRecs.has(w.objId) && !staleRecs.has(w.objId) ) old.push({ ...w, id: e.id }); }
    if ( old.length ) {
      const t = performance.now();
      if ( firstLoad ) Reveal.progressive("destruction", 1500);   // the scene waits for the older look (not the water alone)
      await Promise.all(prioritise(old, objs).map(async (w) => {
        const got = await Net.getChunk(M.dir, w.id, { prio: w.prio });
        if ( got?.sprites && got.F === META_FIELDS ) { staleRecs.set(w.objId, { rk: `${M.base}|${w.objId}|${w.sig}`, objId: w.objId, id: w.id, dir: M.dir, sprites: got.sprites, stale: true }); src.stale = (src.stale ?? 0) + 1; }
      }));
      T.stale = performance.now() - t;
      if ( my !== gen ) return;
      Trace.markOnce("damage:stale", { n: src.stale ?? 0, of: old.length });
      // the older look goes into the scene's one reveal right away; the new bake replaces it stroke by stroke afterwards
      if ( firstLoad && src.stale ) early();
    }
  } else if ( !force && S.baked?.path && S.baked.key === key ) {
    // the first format: one sheet for the whole scene, read once and cut into strokes (the GM's next publish replaces it)
    const t = performance.now();
    const dec = await Store.fetchLegacy(S.baked);
    if ( my !== gen ) return;
    try {
      const meta = dec && readMeta(dec.rgba, dec.w, dec.h, S.baked.metaRows);
      const parts = meta ? Chunks.splitSheet(dec.rgba, dec.w, meta, META_FIELDS) : null;
      if ( parts ) for ( const w of missing() ) { recs.set(w.rk, { rk: w.rk, objId: w.objId, own: w.own, id: null, sprites: parts.get(w.index) ?? [] }); src.legacy++; }
    } catch ( err ) { console.warn(`${MODULE_ID} | destruction: unusable published file`, err); }
    T.decode = performance.now() - t;
  }
  if ( S !== S0 ) return;   // a newer state arrived meanwhile: the next pass (queued) shows it, with what landed here kept

  // 2. strokes nobody has published (yet): a player waits for the GM's chunk, per stroke, and bakes only what is still missing after
  // AWAIT_CHUNK; a chunk that was named but could not be had (gone, broken) is baked at once
  let toBake = missing();
  // a COMPATIBLE older bake version's look (bake-policy.mjs BAKE_VERSIONS: only details changed) stands as final: those strokes are
  // re-baked later - in the background when this tab is idle, on "Rebake all", or at once (client setting). Players never bake them.
  const compatOld = !!M && rule === "older" && !force && !all && Policy.compatible(Policy.verOf(M.base), Policy.verOf(base));
  const mode = rebakeMode();
  let deferred = new Set();
  if ( compatOld && (mode !== "now" || !game.user.isGM) ) {
    let later = toBake.filter((w) => staleRecs.has(w.objId) || shownRecs.get(w.objId)?.stale);
    // an idle pass takes the next few, oldest first (a stroke is baked over the strokes under it: those come before it)
    if ( idle && game.user.isGM ) { later.sort((a, b) => a.index - b.index); later = later.slice(IDLE_BATCH); }
    deferred = new Set(later.map((w) => w.objId));
    toBake = toBake.filter((w) => !deferred.has(w.objId));
  }
  status.compat = deferred.size ? { from: Policy.verOf(M.base), to: Policy.verOf(base), left: deferred.size, of: want.length, mode } : null;
  const broken = new Set(failed.map((w) => w.rk));
  // the GM's chunk is only expected when a GM is here AND the manifest is of this bake version (or there is none yet): a manifest
  // of another bake version means the GM's client runs other code - waiting would only delay the scene by AWAIT_CHUNK
  // (with the older look on screen meanwhile, waiting costs nothing: the GM's client publishes the new version for everyone)
  const sameVersion = !M || String(M.base).split(":")[0] === String(base).split(":")[0] || !!src.stale;
  if ( toBake.length && !force && awaitPublish && !game.user.isGM && game.users.activeGM && sameVersion ) {
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
  // (a stroke is baked over the PLAIN looks of the older strokes it reads, which the worker bakes from their data itself
  // (substrate.mjs): no stroke waits for another's record, any set of strokes bakes in any order and in parallel)
  if ( toBake.length ) {
    // why this client bakes on its own (a loop is then easy to see: console and api.destruction.net.trace().events)
    const why = taken.length ? "edit" : redoSet.size ? "rebake" : force ? "user" : rule === "none" ? "no-manifest" : rule === "older" ? "version-older" : rule === "other" ? "settings-changed" : failed.length ? "chunk-missing" : "signature-changed";
    Trace.event("bake", { why, n: toBake.length, of: want.length });
    if ( !taken.length ) console.warn(`${MODULE_ID} | destruction: baking ${toBake.length} of ${want.length} stroke(s) here (${why})`);
    if ( !taken.length && !force && bakeFail?.key === key ) {
      const wait = Math.min(8 * 60000, 15000 * 2 ** (bakeFail.n - 1)) - (Date.now() - bakeFail.at);
      if ( wait > 0 ) { Trace.event("bake-backoff", { wait }); clearTimeout(bakeTimer); bakeTimer = setTimeout(() => { bakeTimer = 0; rebake(); }, wait); return; }
    }
    if ( !taken.length && !force && !idle && !redoSet.size && !breaker.hit("bake", key) ) { pauseBaking("bake", why); return; }
    // (an idle pass in the background is not "baking" for the status: the compatible look is on screen and stays until it is replaced)
    Object.assign(status, { baking: !idle && !redoSet.size, progress: 0, error: "", bakeDone: 0, bakeTotal: toBake.length, bakeStart: Date.now() }); tell("status");
    if ( src.chunk || src.legacy || src.stale ) show();   // what just landed (or the older look), while the rest bakes
    // a long bake on a scene load: the reveal does not wait for all of it (it shows what is ready after its longer budget, the rest
    // fades in stroke by stroke as it is baked, nearest to the view first)
    // (a Rebake all of many strokes too: two waves on the lane pool, the plain looks they read baked once, with the current code)
    const bigBake = (firstLoad || redoSet.size) && toBake.length >= BIG_BAKE;
    if ( bigBake ) Reveal.progressive("destruction", 1500);
    // the plain looks these strokes are baked over, from records whose pixels were let go: back from their chunks (memory, IndexedDB)
    // - a few ms each, where the worker would bake each again from its data
    {
      const dry = new Set();
      const shells = new Map();
      for ( const w of toBake ) for ( const j of w.deps ) {
        const o = S.objects[j]; const r = o && !o.k ? recs.get(`${base}|${o.id}|${FS[j].sig}`) : null;
        if ( r?.shell ) shells.set(r, j); else if ( r?.sprites.lean ) dry.add(r);
      }
      // (a shell stays a shell on screen - filled in place, all of them were built again in ONE sync: 1.5 s at the start of a Rebake
      // all on "map"): its chunk only lends its plain look, when it is one)
      const lend = [...shells].map(async ([r, j]) => {
        const got = r.id && r.dir ? await Net.getChunk(r.dir, r.id).catch(() => null) : null;
        if ( got?.F === META_FIELDS && got.sprites?.every((s) => s.img) && !overSubstrate(got.sprites) ) plainRecs.set(`${base}|${S0.objects[j].id}|${FS[j].own}`, got.sprites);
      });
      if ( dry.size || lend.length ) { await Promise.all([...[...dry].map(hydrate), ...lend]); if ( my !== gen ) return; }
    }
    try {
      const t = performance.now();
      const getMap = () => { const t1 = performance.now(); const m = sceneMap(S); T.map = (T.map ?? 0) + performance.now() - t1; return m; };
      // only these strokes: the others are left out (an erase stroke is skipped by the bake), so their indices stay as they are
      // the others are `skip`ped (an erase stroke stays one: it is part of what lies under a newer stroke; a skipped stroke still lends
      // its plain look, baked from its data in the worker, to the newer strokes that read it)
      // `under`: the PLAIN looks of the older strokes these read, where this client has them (else the worker bakes them from data)
      const inputOf = (list, plain = false) => {
        const need = new Set(list.map((w) => w.index)), under = {};
        if ( !plain ) for ( const w of list ) for ( const j of w.deps ) { if ( need.has(j) || objs[j].k || under[j] ) continue; const pl = plainOf(j, base, FS); if ( pl ) under[j] = pl; }
        return { objects: objs.map((o, i) => need.has(i) || o.k ? o : { ...o, skip: 1 }), under, plain, mw: S.mw, mh: S.mh, K: Model.K, aw: S.aw, ah: S.ah, seed: S.seed, params: S.params };
      };
      const take = (list, res, plain = false) => {
        const t0 = performance.now();
        const parts = Chunks.splitSheet(res.sheet.data, res.sheet.w, res.meta, META_FIELDS);
        slow("take:split", t0, { n: list.length, plain });
        for ( const w of list ) {
          const sprites = parts.get(w.index) ?? [];
          if ( plain || !overSubstrate(sprites) ) plainRecs.set(`${base}|${w.objId}|${w.own}`, sprites);
          // a plain look is the stroke's final look when it reads nothing
          if ( plain && w.deps.length ) continue;
          recs.set(w.rk, { rk: w.rk, objId: w.objId, own: w.own, id: null, ver: CORE_VERSION, sprites }); waitingSince.delete(w.rk);
        }
        status.stats = res.stats;
      };
      if ( !bigBake ) {
        const res = await runBake(inputOf(toBake), getMap, { onProgress: (p) => { if ( my === gen ) { status.progress = p; tell("status"); } } });
        if ( my !== gen ) return;
        take(toBake, res);
        // (a background rebake: taking the result and putting it on screen go in separate tasks, each well under a frame)
        if ( redoSet.size ) { await new Promise((r) => setTimeout(r, 0)); if ( my !== gen ) return; }
      } else {
        // several workers, the strokes nearest to the view first, each batch on screen as soon as it is baked. TWO WAVES (substrate.mjs):
        // 1. the plain looks (from their own data alone) of every stroke a stroke here reads, and of the strokes here that read nothing
        //    (that look is their final one); 2. the strokes that read others, over those plain looks. Nothing waits longer than that.
        // (a Rebake all: at most 4 lanes - each lane holds every plain look its jobs read, sent once)
        const lanes = redoSet.size ? Math.min(4, bakeLanes()) : bakeLanes();
        Trace.event("bake-lanes", { lanes, cores: navigator.hardwareConcurrency ?? 0 });
        const byIndex = new Map(want.map((w) => [w.index, w])), plainNeed = new Map();
        for ( const w of toBake ) {
          if ( !w.deps.length ) plainNeed.set(w.index, w);
          for ( const j of w.deps ) { const d = byIndex.get(j); if ( d && !plainOf(j, base, FS) ) plainNeed.set(j, d); }
        }
        let timer = 0;
        const soon = () => { if ( !timer && !Reveal.holding("destruction") ) timer = setTimeout(() => { timer = 0; show(); }, 80); };
        Reveal.whenRevealed(() => soon());
        for ( const [wave, list, plain] of [[0, [...plainNeed.values()], true], [1, toBake.filter((w) => w.deps.length), false]] ) {
          const order = prioritise(list, objs);
          const size = Math.max(2, Math.ceil(order.length / (lanes * 4))), jobs = [], tw = performance.now();
          for ( let i = 0; i < order.length; i += size ) jobs.push(order.slice(i, i + size));
          // results are taken on the page a slice at a time (~8 ms, then a pause): many lanes finishing together never make a long task
          const queue = [];
          let draining = null;
          const drain = () => draining ??= (async () => {
            while ( queue.length ) {
              const t0 = performance.now();
              while ( queue.length && performance.now() - t0 < 8 ) queue.shift()();
              if ( queue.length ) await new Promise((r) => setTimeout(r, 0));
            }
          })().finally(() => { draining = null; });
          // (a background Rebake: the plain looks its strokes read go to each lane ONCE, a look per message between frames (prime), and the
          // jobs only name them - copying them into every job held the page for up to 1.5 s per job)
          const tIn = performance.now();
          let inputs = jobs.map((jb) => inputOf(jb, plain)), prime = null;
          slow("inputs", tIn, { jobs: jobs.length, plain });
          if ( redoSet.size && !plain ) {
            const sent = new Map();
            inputs = jobs.map((jb) => {
              const need = new Set(jb.map((w) => w.index)), underKeys = {};
              for ( const w of jb ) for ( const j of w.deps ) {
                if ( need.has(j) || objs[j].k || underKeys[j] ) continue;
                const pl = plainOf(j, base, FS); if ( !pl ) continue;
                const k = `${S.objects[j].id}|${FS[j].own}`;
                underKeys[j] = k; if ( !sent.has(k) ) sent.set(k, pl);
              }
              return { ...inputOf(jb, plain), under: {}, underKeys };
            });
            prime = [...sent].map(([key, sprites]) => ({ key, sprites }));
            slow("inputs+prime", tIn, { looks: prime.length });
            Trace.event("rebake-prime", { looks: prime.length, mpx: Math.round(prime.reduce((a, p) => a + p.sprites.reduce((q, s) => q + s.w * s.h, 0), 0) / 1e5) / 10 });
          }
          await runBakePool(inputs, getMap, { n: lanes, prime, onDone: (i, res) => {
            queue.push(() => {
              if ( my !== gen ) return;
              take(jobs[i], res, plain);
              const done = jobs[i].filter((w) => toBake.includes(w) && (!plain || !w.deps.length)).length;
              status.bakeDone += done; status.progress = status.bakeDone / status.bakeTotal;
              if ( redoSet.size && status.rebake ) status.rebake.live = status.bakeDone;   // (the Rebake all line counts within a pass)
              tell("status");
              if ( done ) { soon(); early(); }
            });
            drain();
          } });
          while ( queue.length || draining ) await (draining ?? drain());
          Trace.event("bake-wave", { wave, plain, n: order.length, jobs: jobs.length, ms: Math.round(performance.now() - tw) });
          if ( my !== gen ) break;
        }
        clearTimeout(timer);
        if ( my !== gen ) return;
      }
      src.baked = toBake.length;
      T.bake = performance.now() - t; status.ms = Math.round(T.bake);
    } catch ( err ) {
      if ( my !== gen ) return;
      console.error(`${MODULE_ID} | destruction bake`, err);
      // a failing bake is tried again on its own only after a growing pause (15 s doubling to 8 min), never back to back
      bakeFail = { key, n: (bakeFail?.key === key ? bakeFail.n : 0) + 1, at: Date.now() };
      Trace.event("bake-failed", { n: bakeFail.n, error: String(err?.message ?? err).slice(0, 160) });
      Object.assign(status, { baking: false, error: String(err?.message ?? err) }); tell("status");
      return;
    }
    // a setting changed while this baked (clicking through toggles): the bake for the final state follows, this one is not shown
    if ( (rev !== paramRev || S !== S0) && !force ) { strokes.unshift(...taken); Object.assign(status, { baking: false }); tell("status"); if ( !bakeTimer ) again ??= {}; return; }
  }

  // 3. on screen: everything we have (on a scene load, hidden until the reveal: every shard made, every texture uploaded)
  await show();
  if ( my !== gen ) return;
  if ( firstLoad && Reveal.holding("destruction") && display ) await (prepping ?? prepareReveal(my));
  const complete = want.every((w) => recs.has(w.rk));
  // on screen in full - some strokes perhaps in a compatible older look that stands until its background re-bake
  const shownFull = complete || want.every((w) => recs.has(w.rk) || (deferred.has(w.objId) && (staleRecs.has(w.objId) || shownRecs.get(w.objId)?.stale)));
  if ( shownFull && !complete ) {
    shownKey = key;
    if ( game.user.isGM && mode === "background" ) scheduleIdleRebake(idle ? 250 : 4000);   // (the next few right after, while still idle)
    Trace.event("compat-shown", { from: status.compat?.from, left: deferred.size, mode });
  }
  if ( complete ) { shownKey = key; waitingSince.clear(); Trace.markOnce("damage:all", { groups: display?.groups.size ?? 0, uploads: display?.stats?.uploads ?? 0, ...src }); }
  // strokes pinned to an older look than the current code would draw for their kind (Damage panel: "Rebake all")
  status.olderLook = olderLooks(want);
  // the composite's shells that need their pixels anyway (flooded holes, a dark scene); the GM keeps the composite up to date
  // (after the scene's reveal: filled during the load, their building held the reveal back ~0.5 s)
  if ( src.composite ) Reveal.whenRevealed(() => setTimeout(() => { if ( my === gen ) shellNeeds(); }, 50));
  // (and, a little later, the pixels of what is in and around the view, so that an entry there rarely has to wait for them)
  Reveal.whenRevealed(() => setTimeout(() => { if ( my === gen ) prefetchNear(); }, 2500));
  if ( complete && game.user.isGM ) scheduleComposite();
  // records no stroke uses any more (an older look, an undone stroke) are let go
  const live = new Set([...want.map((w) => w.rk), ...[...shownRecs.values()].map((r) => r.rk)]);
  for ( const k of recs.keys() ) if ( !live.has(k) ) recs.delete(k);
  { const keep = new Set(want.map((w) => `${base}|${w.objId}|${w.own}`)); for ( const k of plainRecs.keys() ) if ( !keep.has(k) ) plainRecs.delete(k); }
  T.total = performance.now() - T.t0;
  const source = Object.entries(src).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ") || "memory";
  Object.assign(status, { baking: false, waiting: !complete, loading: 0, progress: 1, source, hash: "", error: "", perf: Object.fromEntries(Object.entries(T).filter(([k]) => k !== "t0").map(([k, v]) => [k, Math.round(v * 10) / 10])) });
  tell("status");
  // (during a Rebake all the manifest is written once, at its end)
  if ( game.user.isGM && complete && !status.rebake ) schedulePersist(src.baked + src.legacy);
  maybeBlast(firstLoad);
}

/**
 * A scene load, before its reveal (the damage is on screen but hidden): every shard sprite made (the display otherwise makes a few
 * hundred per frame, so a big area's pieces would appear over several frames), every area's texture uploaded a slice at a time, and
 * the flooded holes' water in; then this layer is ready. Time slices of ~8 ms, so the page never stalls.
 */
async function prepareReveal(my) {
  const T = performance.now(), slice = () => new Promise((r) => setTimeout(r, 0));
  let t = performance.now();
  // only what is in view (an area off screen is not drawn: its shards are made and its texture uploaded later, unseen)
  const vw = display.view?.(), inView = (g) => { const r = g.info?.rect; return !vw || !r || !(r.x0 > vw.x1 || r.y0 > vw.y1 || r.x1 < vw.x0 || r.y1 < vw.y0); };
  const visible = display.order.filter(inView);
  Trace.markOnce("damage:visible", { groups: visible.length, of: display.order.length });
  for ( const g of visible ) {
    while ( g.made < g.pieces.length ) {
      display.materialize(g, 800);
      if ( performance.now() - t > 8 ) { await slice(); if ( my !== gen || !display ) return; t = performance.now(); }
    }
  }
  Trace.markOnce("damage:made", { ms: Math.round(performance.now() - T) });
  await Reveal.upload(visible.flatMap((g) => display.texturesOf(g)));
  Trace.markOnce("damage:uploaded", { ms: Math.round(performance.now() - T) });
  // the flooded holes fill with their own water loop a moment after their area is in: wait for it while the reveal waits
  const until = performance.now() + 1500;
  while ( my === gen && Reveal.holding("destruction") && performance.now() < until ) {
    // (its holes are listed a moment after the areas are in: none listed yet while there are flood strokes is not "done")
    // (holes shown from the settled composite get their water a moment later, after their pixels: not waited for here)
    const holes = destructionApi.flood?.status?.()?.holes, floods = S?.objects?.some((o) => !o.k && Model.TYPES[o.t] === "flood") && !display.order.some((g) => g.shell && g.info.type === "flood");
    if ( !floods || !destructionApi.flood ) break;
    if ( holes?.length && holes.every((h) => h.state === "ready" || h.state === "none") ) break;
    await new Promise((r) => setTimeout(r, 30));
  }
  if ( my !== gen ) return;
  Trace.markOnce("damage:prepared", { ms: Math.round(performance.now() - T) });
  Reveal.ready("destruction");
}

/** Is a stroke (its box, with room for its debris) in the current view? */
function inView(o) {
  const r = Model.sceneRect(), mpx = S.ap * Model.K, st = canvas.stage, sc = st?.scale?.x || 1;
  if ( !st || !o ) return true;
  const hw = (canvas.app?.screen?.width ?? 1920) / 2 / sc, hh = (canvas.app?.screen?.height ?? 1080) / 2 / sc, m = 64 * S.ap;
  const x0 = r.x + o.x0 * mpx - m, y0 = r.y + o.y0 * mpx - m, x1 = r.x + (o.x0 + o.w) * mpx + m, y1 = r.y + (o.y0 + o.h) * mpx + m;
  return !(x0 > st.pivot.x + hw || x1 < st.pivot.x - hw || y0 > st.pivot.y + hh || y1 < st.pivot.y - hh);
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
function showRecs(want, objs, taken, mask, first, soft = false, allow = null) {
  const list = [], next = new Map(), shells = [];
  depOnly.clear();
  for ( const w of want ) {
    // (allow: the strokes that may take their new record - or their older look - in this step; the others keep what they show)
    const fresh = recs.get(w.rk);
    const r = (!allow || allow.has(w.objId) ? fresh ?? staleRecs.get(w.objId) : null) ?? shownRecs.get(w.objId);
    if ( fresh && r === fresh ) staleRecs.delete(w.objId);
    if ( !r ) continue;
    // (a record without its pixels whose areas are not on screen - its chunk could not be had again - is left out: never a blank sheet)
    if ( r.sprites.lean && !onScreen(r) ) continue;
    // a new look only because the strokes under it changed (its own inputs did not): swapped in one frame, no entry, no fade
    const prev = shownRecs.get(w.objId);
    if ( prev && prev !== r && prev.own && prev.own === w.own && !prev.stale ) depOnly.add(w.objId);
    list.push({ index: w.index, sprites: r.sprites, id: r.id ?? null, shell: !!r.shell });
    if ( r.shell ) for ( const a of r.shell ) shells.push({ ...a, index: w.index, obj: w.objId });
    next.set(w.objId, r);
  }
  shownRecs = next;
  display ??= new DestructionDisplay();
  if ( compositeShown && display.composite !== compositeShown ) { display.composite = compositeShown; display.needPixels = requestPixels; }
  display.afterFlatten ??= afterFlatten;
  display.pixelSource ??= pixelSource;
  display.setIdle(S.params.idle, S.params.fxWho); display.setLook(lookOf(S.params));
  // the areas already on screen need no pixels (the display keeps them by hash; a shell's pixels replace it)
  const sheet = Chunks.assembleSheet(list, META_FIELDS, (h) => display.groups.has(h) && !display.groups.get(h).shell);
  const { added, removed } = display.sync(sheet.data, sheet.w, sheet.h, sheet.meta, S.ap, origin(), objs, shells);
  // MEMORY: the display holds its own copy of every area's pixels now; a record that can be had again from its chunk lets go of its
  // own copy (a big scene's records were ~230 MB of RGBA kept twice). They come back (hydrate) when an area of theirs must be built
  // again, or the stroke is baked over.
  for ( const r of next.values() ) if ( !r.shell && !r.sprites.lean && r.id && r.dir && onScreen(r) ) dry(r);
  playEntries(added, removed, taken, mask, first);
  if ( soft ) { const t = performance.now(); for ( const g of added ) if ( !g.anim && !g.fade && !g.reused ) { g.fade = { start: t, dur: 300 }; display.applyFade(g, t); } }
  lastRecs = list;
  Reveal.attach("destruction", display.objs, display.fx, display.causeLights?.layer);   // (only while this layer is held back)
  if ( display.groups.size ) Trace.markOnce("damage:first", { groups: display.groups.size });
  status.areas = display.order.map((g) => ({ type: g.info.type, mat: Model.MATERIALS[g.info.mat + 1] ?? "earth", hash: g.info.hash, cause: g.info.cause ?? 0, obj: g.objId ?? null }));
}

/**
 * Which new areas enter, and how. A new area under the GM's stroke enters from the stroke's start (gashes along it); an area that
 * replaced an older one (a stroke grew it) only reveals the changed part and fades the rest over. On load, or for a player, the
 * entries come from the scene flag (server time): recent ones play, older ones are shown settled. Areas this client has shown before
 * never enter again.
 */
/** Was a record baked over a substrate (a part's cover row carries field 7 = 1, core.mjs)? Else it is the stroke's plain look too. */
const overSubstrate = (sprites) => sprites.some((s) => s.m[0] === 2 && s.m[7] === 1);
/** Stroke j's plain look, when this client has it: kept from a plain bake, or its final record when that was not over a substrate. */
function plainOf(j, base, FS) {
  const o = S?.objects?.[j]; if ( !o || o.k ) return null;
  const p = plainRecs.get(`${base}|${o.id}|${FS[j].own}`); if ( p ) return p.lean ? null : p;
  const r = recs.get(`${base}|${o.id}|${FS[j].sig}`);
  return r && !r.shell && !r.sprites.lean && !overSubstrate(r.sprites) ? r.sprites : null;
}

/* ---------------------------------------------------------------- records without their pixels (memory) */

/** The base rows' area hashes of a record. */
const hashesOf = (r) => r.sprites.filter((s) => s.m[0] === 0).map((s) => ((s.m[12] & 0xffff) | ((s.m[13] & 0xffff) << 16)) >>> 0);
/** Is every area of a record on screen with its pixels (the display keeps them; a shell has none)? */
const onScreen = (r) => !!display && hashesOf(r).every((h) => { const g = display.groups.get(h); return !!g && !g.shell; });
/**
 * Let go of a record's pixels (its rows stay): `sprites.lean`. The decoded chunk in the stream's memory goes too (it is the same
 * object): what is kept is the chunk's compressed bytes (IndexedDB), decoded again when needed.
 */
function dry(r) {
  for ( const s of r.sprites ) s.img = null;
  r.sprites.lean = true;
  Net.forget(r.id);
}
/** Records that must have their pixels for the next sheet (an area of theirs is not on screen). */
function needPixels(want) {
  const out = new Set();
  for ( const w of want ) for ( const r of [recs.get(w.rk), staleRecs.get(w.objId), shownRecs.get(w.objId)] ) if ( r?.sprites.lean && !onScreen(r) ) out.add(r);
  return [...out];
}
/** A record's pixels back from its chunk (memory, IndexedDB, the server), in place. A chunk that cannot be had drops the record. */
async function hydrate(r) {
  if ( !r.sprites.lean && !r.shell ) return true;
  r.hydrating ??= (async () => {
    const got = r.id && r.dir ? await Net.getChunk(r.dir, r.id).catch(() => null) : null;
    // a shell (composite.mjs) takes the chunk's sprites as they are
    if ( r.shell && got?.F === META_FIELDS && got.sprites?.every((s) => s.img) ) { r.sprites = got.sprites; r.shell = null; return true; }
    const ok = !r.shell && got?.sprites?.length === r.sprites.length && got.sprites.every((s, k) => s.img && s.w === r.sprites[k].w && s.h === r.sprites[k].h);
    if ( ok ) { r.sprites.forEach((s, k) => { s.img = got.sprites[k].img; }); r.sprites.lean = false; }
    else {
      console.warn(`${MODULE_ID} | destruction: chunk ${r.id} could not be read again`);
      if ( recs.get(r.rk) === r ) recs.delete(r.rk);
      if ( staleRecs.get(r.objId) === r ) staleRecs.delete(r.objId);
    }
    if ( !ok ) Trace.event("hydrate-failed", { id: r.id });
    return ok;
  })().finally(() => { r.hydrating = null; });
  return r.hydrating;
}

/* ---------------------------------------------------------------- the settled composite (composite.mjs) */

/**
 * Scene load: the composite's strokes as shells. Only when the composite is of this bake (`base`), every stroke it holds is here with
 * the same signature, and the scene's other strokes are all newer (on top: drawn over its bands). -> the number of strokes, or 0.
 */
async function compositeLoad(scene, base, want, M) {
  if ( !Composite.enabled() || !cacheEnabled() ) return 0;
  const CM = Composite.manifestOf(scene);
  if ( !CM || !Store.sameBase(CM.base, base, Store.legacyBaseKey(scene, S, backgroundInfo()?.path ?? "")) ) return 0;
  // the composite IS the damage on this load: the scene's one reveal waits for it (a few files, read ahead since canvasInit)
  Reveal.progressive("destruction", 4000);
  const c = await Composite.load(CM);
  if ( !c ) return 0;
  const ix = c.index, byId = new Map(want.map((w) => [w.objId, w])), covered = [];
  for ( const [id, s] of Object.entries(ix.strokes ?? {}) ) {
    const w = byId.get(id);
    // (the same inputs AND the same chunk: a stroke re-baked by newer code under the same signature has other areas - version pinning)
    const e = M ? Store.entryOf(M, id) : null;
    if ( !w || w.sig !== s.sig || (s.cid && s.cid !== e?.id) ) { c.destroy(); Trace.event("composite-stale", { stroke: id, why: !w ? "gone" : w.sig !== s.sig ? "signature" : "chunk" }); return 0; }
    covered.push(w);
  }
  const last = Math.max(-1, ...covered.map((w) => w.index));
  if ( want.some((w) => w.index < last && !ix.strokes[w.objId]) ) { c.destroy(); Trace.event("composite-stale", { why: "an older stroke is not in it" }); return 0; }
  compositeShown?.destroy(); compositeShown = c;
  for ( const w of covered ) {
    if ( recs.has(w.rk) ) continue;
    const e = M ? Store.entryOf(M, w.objId) : null;
    const areas = (ix.strokes[w.objId].hashes ?? []).map((h) => ix.areas[h]).filter(Boolean);
    recs.set(w.rk, { rk: w.rk, objId: w.objId, own: w.own, id: e?.sig === w.sig ? e.id : null, ver: e?.sig === w.sig ? e.ver : CORE_VERSION, dir: M?.dir ?? null, sprites: [], shell: areas });
  }
  Trace.event("composite", { strokes: covered.length, of: want.length, mpx: Math.round(c.px / 1e5) / 10 });
  return covered.length;
}

/** Profiling (tests): a step that held the page more than 20 ms goes into net.trace().events as slow. */
const slow = (name, t0, data = null) => { const ms = performance.now() - t0; if ( ms > 20 ) Trace.event("slow", { name, ms: Math.round(ms), ...(data ?? {}) }); };

/** The records shown or kept as shells. */
const shellRecs = () => [...new Set([...recs.values(), ...shownRecs.values(), ...staleRecs.values()])].filter((r) => r.shell);

/** Records' pixels back from their chunks, then on screen (the shells replaced by their areas in place). */
async function fill(list, why) {
  if ( !list.length ) return true;
  const my = gen, t = performance.now();
  // the chunks all come at once (one IndexedDB read, the pool decodes), but they go on screen a few strokes per frame: a shell
  // replaced by its areas builds them (~15 ms a stroke), and 98 at once held the page 1.5 s. A shell not yet filled keeps showing
  // the composite's bands meanwhile, so nothing changes on screen but the order.
  for ( const r of list ) if ( r.id && r.dir ) Net.getChunk(r.dir, r.id).catch(() => null);
  const oks = [];
  let step = FILL_STEP;
  for ( let i = 0; i < list.length; i += step ) {
    const part = list.slice(i, i + step);
    oks.push(...await Promise.all(part.map(hydrate)));
    if ( my !== gen ) return false;
    const t1 = performance.now();
    await reshow?.();
    if ( my !== gen ) return false;
    // (the next step as big as fits ~24 ms, from what this one cost)
    const per = (performance.now() - t1) / Math.max(1, part.length);
    step = Math.max(1, Math.min(8, Math.floor(24 / Math.max(1, per))));
    if ( i + part.length < list.length ) await new Promise((r) => setTimeout(r, 16));
    if ( my !== gen ) return false;
  }
  Trace.event("shells-filled", { why, n: list.length, failed: oks.filter((v) => !v).length, ms: Math.round(performance.now() - t) });
  if ( oks.some((v) => !v) ) { shownKey = ""; rebake({ awaitPublish: false }); }   // (a chunk that could not be had: fetched or baked again)
  return oks.every(Boolean);
}
/* ---------------------------------------------------------------- atlases let go after flatten (display.freeAtlas) */

/**
 * MEMORY: a flattened area of a stroke whose chunk can be had again lets go of its atlas' CPU copy, right after the sync that built
 * it (its map patch reads it first). Not a flooded hole (its water reads its atlas). `CONFIG.moinenMaps.keepAtlas = true`: kept.
 */
const atlasQueue = new Set();
let atlasTimer = 0;
function afterFlatten(g) {
  if ( g.info?.type === "flood" || globalThis.CONFIG?.moinenMaps?.keepAtlas ) return;
  atlasQueue.add(g);
  atlasTimer ||= setTimeout(() => {
    atlasTimer = 0;
    for ( const q of atlasQueue ) { const r = shownRecs.get(q.objId); if ( !q.dead && r?.id && r.dir && !r.shell ) display?.freeAtlas(q); }
    atlasQueue.clear();
  }, 0);
}
/** A record's sprites of one area (by its base row's hash) as display.build laid them out: base, shards in order, cover, light. */
function areaSprites(r, hash) {
  const out = { base: null, pieces: [], cover: null, light: null };
  let on = false;
  for ( const s of r.sprites ) {
    if ( s.m[0] === 0 ) { on = (((s.m[12] & 0xffff) | ((s.m[13] & 0xffff) << 16)) >>> 0) === hash; if ( on ) out.base = s; continue; }
    if ( !on ) continue;
    if ( s.m[0] === 2 ) out.cover = s; else if ( s.m[0] === 3 ) out.light = s; else out.pieces.push(s);
  }
  return out.base ? [out.base, ...out.pieces, ...(out.cover ? [out.cover] : []), ...(out.light ? [out.light] : [])] : [];
}
/** Before every area enters again (Detonate, replay): the shells their pixels, the areas their atlases. */
async function pixelsForEntries() {
  if ( !display ) return;
  if ( display.shellCount ) await hydrateShells("entries");
  const free = [...display.groups.values()].filter((g) => g.atlasFree);
  const recsOf = new Map(free.map((g) => [g, shownRecs.get(g.objId)]));
  await Promise.all([...new Set(recsOf.values())].filter(Boolean).map(hydrate));
  let n = 0;
  for ( const g of free ) { const r = recsOf.get(g); if ( r && !r.sprites.lean && display?.restoreAtlas(g, areaSprites(r, g.hash)) ) n++; }
  Trace.event("atlases-restored", { n, of: free.length });
}

/**
 * The display's entries ask for the pixels of areas that have none (display.waitPixels): the shells among them are refilled (fill,
 * in steps: each replaced in place as its step lands), the freed atlases' records hydrated -> Map(group -> its sprites).
 */
async function pixelSource(groups) {
  const out = new Map(), recOf = (g) => shownRecs.get(g.objId);
  const shells = [...new Set(groups.filter((g) => g.shell).map(recOf).filter((r) => r?.shell))];
  if ( shells.length ) fill(shells, "entries");
  await Promise.all(groups.filter((g) => g.atlasFree).map(async (g) => { const r = recOf(g); if ( r && (await hydrate(r)) && !r.sprites.lean ) out.set(g, areaSprites(r, g.hash)); }));
  return out;
}

/**
 * After a load, in the background: the areas in view (and half a view round it) that have no pixels get them ahead of an entry
 * (display.waitPixels waits 150 ms at most): their shells filled (fill: a few per step), the chunks of their freed atlases read into the
 * stream's memory. `CONFIG.moinenMaps.noPrefetch = true`: none.
 */
function prefetchNear() {
  if ( !display || !canvas.ready || globalThis.CONFIG?.moinenMaps?.noPrefetch ) return;
  const vw = display.view(), mx = (vw.x1 - vw.x0) * 0.5, my = (vw.y1 - vw.y0) * 0.5;
  const near = (r) => !(r.x0 > vw.x1 + mx || r.y0 > vw.y1 + my || r.x1 < vw.x0 - mx || r.y1 < vw.y0 - my);
  const groups = [...display.groups.values()].filter((g) => (g.shell || g.atlasFree) && g.info?.rect && near(g.info.rect));
  const shells = [...new Set(groups.filter((g) => g.shell).map((g) => shownRecs.get(g.objId)).filter((r) => r?.shell))];
  Trace.event("prefetch", { shells: shells.length, atlases: groups.filter((g) => g.atlasFree).length });
  if ( shells.length ) fill(shells, "prefetch");
  for ( const g of groups ) if ( g.atlasFree ) { const r = shownRecs.get(g.objId); if ( r?.id && r.dir ) Net.getChunk(r.dir, r.id).catch(() => null); }
}

/** Every shell gets its pixels (a change that is not a new stroke on top, Detonate, a dark scene). */
const hydrateShells = (why) => fill(shellRecs(), why);

/**
 * The cache asks for the pixels of shells it must draw itself (a band the composite does not have, drawing without the cache). Every ask
 * is kept until it is served: an ask made while a fill runs (the cache re-draws as each step lands and asks for the rest) is served by the
 * next round - before, it was dropped, and the cache waited for ever with a stale band (no composite publish, "cache-not-settled").
 */
let pixelAsk = null, lastOrphans = 0;
const ASK_DELAY = 700;
const asked = new Set();
function requestPixels(groups) {
  for ( const g of groups ) asked.add(g.hash);
  pixelAsk ??= (async () => {
    // (served a moment later, and only while the cache still waits: a stroke fading out for 260 ms - an undo - splits the bands for a
    // few frames and asked for every shell under it; once it is gone the composite's bands match again and nothing is needed)
    await new Promise((r) => setTimeout(r, ASK_DELAY));
    while ( asked.size ) {
      if ( !display?.cache?.waiting ) { asked.clear(); break; }
      const want = new Set(asked); asked.clear();
      const list = shellRecs().filter((r) => !r.hydrating && r.shell.some((a) => want.has(a.h)));
      if ( list.length ) { await fill(list, "cache"); continue; }
      // a shell whose stroke's record is no shell any more (filled, perhaps let go of its pixels since): that record gets its pixels and
      // the scene is shown again from its records - once per set of such shells (a set that stays is not tried in a loop)
      // (at most every 500 ms: while a pass is on its way the records are not all there yet; the cache asks again as it re-draws)
      const orphans = [...want].filter((h) => display?.groups.get(h)?.shell);
      if ( !orphans.length || performance.now() - lastOrphans < 500 ) break;
      lastOrphans = performance.now();
      const objs = new Set(orphans.map((h) => display.groups.get(h).objId));
      Trace.event("shells-orphan", { n: orphans.length });
      await Promise.all([...shownRecs.values()].filter((r) => objs.has(r.objId) && r.sprites.lean).map(hydrate));
      await reshow?.();
    }
  })().finally(() => { pixelAsk = null; });
}

/**
 * After a load from the composite: the shells that need their pixels anyway get them, in the background - a flooded hole (its water
 * reads its cover and base), a glowing cause light in a dark scene, every shell in a dark scene (the rim light).
 */
function shellNeeds() {
  const list = shellRecs(); if ( !list.length ) return;
  const dark = canvas.environment?.darknessLevel ?? 0;
  // a dark scene's rim light needs an area's pixels: only the shells in view (and a margin) get them, the others as the view reaches
  // them (canvasPan below)
  const vw = dark >= 0.45 ? display?.view?.() : null, m = 160;
  const inView = (a) => !!vw && !(a.rect[0] > vw.x1 + m || a.rect[1] > vw.y1 + m || a.rect[2] < vw.x0 - m || a.rect[3] < vw.y0 - m);
  fill(list.filter((r) => r.shell.some((a) => a.type === "flood" || (dark > 0.05 && a.l) || inView(a))), dark >= 0.45 ? "dark/view" : "flood/light");
}
let darkTimer = 0;
const darkCheck = () => { clearTimeout(darkTimer); darkTimer = setTimeout(() => { if ( shellRecs().length && (canvas.environment?.darknessLevel ?? 0) > 0.05 ) shellNeeds(); }, 300); };
Hooks.on("lightingRefresh", darkCheck);
Hooks.on("canvasPan", darkCheck);

/**
 * GM: publish the composite of what is on screen once it is settled (composite.mjs publish says when it is not: tried again a few
 * times). Only the active GM; after a publish of the strokes, and on a load whose composite is missing or out of date.
 */
function scheduleComposite(ms = 4000) {
  if ( !game.user.isGM || !Composite.enabled() ) return;
  clearTimeout(compositeTimer);
  compositeTimer = setTimeout(async () => {
    compositeTimer = 0;
    if ( !S || !display || !canvas.scene || !game.users.activeGM?.isSelf || inflight || persisting ) return scheduleComposite(3000);
    const scene = canvas.scene, bg = backgroundInfo()?.path ?? "", key = Store.makeKey(scene, S, bg);
    if ( shownKey !== key ) return;                 // not all on screen: the pass that completes it books a run
    const FS = Store.sigsOf(S), M = Store.manifestOf(S);
    const strokes = S.objects.map((o, i) => { if ( o.k ) return null; const e = M ? Store.entryOf(M, o.id) : null; return { id: o.id, sig: FS[i].sig, cid: e?.sig === FS[i].sig ? e.id : null }; }).filter(Boolean);
    // a composite can only be made of real areas: shells left (their bands waiting) get their pixels first, then the next try publishes
    if ( display.shellCount && display.cache?.waiting ) { Trace.event("composite-fill", { shells: display.shellCount }); await hydrateShells("publish"); return scheduleComposite(1500); }
    let why;
    try { why = await Composite.publish(display, { scene, dir: Net.chunkDir(scene.id), base: Store.baseKey(scene, S, bg), strokes }); }
    catch ( err ) { why = "error"; console.warn(`${MODULE_ID} | destruction: composite not published`, err); }
    if ( why === "published" || why === "same" ) { compositeTries = 0; return; }
    Trace.event("composite-wait", { why, tries: compositeTries });
    // tried again, less and less often (2 s doubling to 60 s), as long as this scene and state stay: never given up silently
    compositeTries++;
    if ( compositeTries === 30 ) console.warn(`${MODULE_ID} | destruction: the settled composite still not published (${why})`);
    scheduleComposite(why === "error" ? 30000 : Math.min(60000, 2000 * 2 ** Math.min(5, Math.floor(compositeTries / 5))));
  }, ms);
}

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
    if ( depOnly.has(g.objId) && under.length ) { played.add(h); display.swap(g, under, 0); depStats.swaps++; continue; }
    // shown here before (a look toggle switched back, an undo), or a new look of existing damage: no entry, a cross-fade
    if ( g.reused || (played.has(h) && !all) ) { played.add(h); display.swap(g, under); continue; }
    played.add(h);
    const e = flag.get(h);
    if ( e && (first || !game.user.isGM) ) {
      // from the flag: the same moment for everyone who is here; a late arrival still sees it whole, an old one stays settled
      const age = ageOf(e.t, sNow);
      if ( age > ENTRY_WINDOW ) { display.swap(g, under); continue; }
      display.enter(g, { start: pNow + Math.max(0, -age), o: dirOn ? e.o ?? null : null, dir: dirOn ? e.d ?? null : null, under,
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
  const late = ageOf(b.t, now());                  // Infinity: a legacy (uptime) or far-future moment, never played
  // (every area enters: the shells get their pixels first)
  if ( S.params.anim && late < (first ? 4000 : 15000) ) { const t = performance.now() - late; if ( !display.pixelSource && (display.shellCount || display.stats.atlasFreed) ) pixelsForEntries().then(() => display?.detonate(t)); else display.detonate(t); }   // the shared moment (in the future, or already running)
}

/* ---------------------------------------------------------------- publishing the chunks (GM) */

/**
 * A moment after a bake is on screen (sooner for a small edit): the strokes the manifest does not name yet are encoded in the codec
 * worker (in parallel with the next bake), uploaded (only what the server lacks, a few at a time) and named in the manifest together
 * with the entries that played since. One run at a time; a run asked for meanwhile follows it.
 */
/* ---------------------------------------------------------------- pinned older looks and Rebake all (bake-policy.mjs) */

/** The strokes on screen whose look is older than the current code's for their kind: { n, from, to, ids } or null. */
function olderLooks(want) {
  if ( !S ) return null;
  const ids = [];
  let from = Infinity;
  for ( const w of want ) {
    const r = recs.get(w.rk) ?? shownRecs.get(w.objId), o = S.objects[w.index];
    if ( !r || !o ) continue;
    const ver = Number.isFinite(r.ver) ? r.ver : CORE_VERSION;
    if ( Policy.olderLook(ver, Model.TYPES[o.t], !!(o.c || S.params.cause), CORE_VERSION) ) { ids.push(w.objId); from = Math.min(from, ver); }
  }
  return ids.length ? { n: ids.length, from, to: CORE_VERSION, ids } : null;
}

/*
 * REBAKE ALL (or one stroke): in the background, a couple of strokes at a time (the nearest to the view first, each followed by the
 * strokes that read it), one pass every 250 ms while nothing else bakes; each new look is swapped in silently; the manifest is written
 * once at the end. Pause / resume / cancel from the Damage panel. status.rebake: { total, done, paused } while it runs.
 */
// a pass is a big bake of up to REBAKE_BATCH strokes on the lane pool (two waves: the plain looks they read once, then the strokes);
// pause and cancel act between passes
const REBAKE_BATCH = 96, REBAKE_EVERY = 250;
let rebakeQueue = [], rebakeTimer = 0;
export function rebakeStrokes(ids = null) {
  if ( !S || !game.user.isGM ) return;
  const bg = backgroundInfo()?.path ?? "", base = Store.baseKey(canvas.scene, S, bg), FS = Store.sigsOf(S), objs = objectsIn();
  const list = ids ?? status.olderLook?.ids ?? [];
  if ( !list.length ) return;
  const wantIds = new Set(list), entries = [];
  // the strokes that read each stroke (their substrate changes with it), in one pass
  const readers = new Map();
  S.objects.forEach((q, j) => { if ( !q.k ) for ( const i of FS[j]?.deps ?? [] ) { if ( !readers.has(i) ) readers.set(i, []); readers.get(i).push(q.id); } });
  S.objects.forEach((o, index) => {
    if ( o.k || !wantIds.has(o.id) ) return;
    entries.push({ objId: o.id, index, dist: inView(objs[index]) ? 0 : 1, dependents: readers.get(index) ?? [] });
  });
  void base;
  rebakeQueue = Policy.rebakeOrder(entries);
  status.rebake = { total: rebakeQueue.length, done: 0, paused: false };
  Trace.event("rebake-start", { n: rebakeQueue.length });
  tell("status");
  pumpRebake(50);
}
function pumpRebake(ms = REBAKE_EVERY) {
  clearTimeout(rebakeTimer);
  rebakeTimer = setTimeout(async () => {
    rebakeTimer = 0;
    const R = status.rebake;
    if ( !S || !R || R.paused ) return;
    if ( !rebakeQueue.length ) { status.rebake = null; Trace.event("rebake-done", { n: R.total }); tell("status"); schedulePersist(0); return; }
    if ( inflight || document.visibilityState !== "visible" ) return pumpRebake(REBAKE_EVERY);
    const batch = rebakeQueue.splice(0, REBAKE_BATCH);
    await rebake({ awaitPublish: false, redo: batch });
    // a pass that failed (an error, a backoff) stops the Rebake all and says so: never "done" with strokes not baked
    if ( status.error || bakeFail ) { Trace.event("rebake-failed", { error: status.error, left: rebakeQueue.length + batch.length }); rebakeQueue = []; status.rebake = null; tell("status"); return; }
    if ( status.rebake ) { status.rebake.done += batch.length; status.rebake.live = 0; tell("status"); }
    pumpRebake(REBAKE_EVERY);
  }, ms);
}
export function rebakePause(paused = true) { if ( status.rebake ) { status.rebake.paused = paused; tell("status"); if ( !paused ) pumpRebake(50); } }
export function rebakeCancel() { rebakeQueue = []; clearTimeout(rebakeTimer); if ( status.rebake ) { Trace.event("rebake-cancel", status.rebake); status.rebake = null; tell("status"); schedulePersist(0); } }

/* ---------------------------------------------------------------- how many workers a big bake uses */

/**
 * Lanes (workers) for a big bake: the client setting "Bake threads" (auto, or 1-8). Auto: the logical cores minus two (the page and
 * the GPU's process keep theirs), 2 to 8; only 2 in performance mode Low, while the tab is hidden, or on a battery running low and
 * not charging. Each lane is a separate thread (the page only takes the results, a slice per frame).
 */
let battery = null;
try { globalThis.navigator?.getBattery?.().then((b) => { battery = b; }).catch(() => {}); } catch { /* not offered */ }
export function bakeLanes() {
  let set = "auto";
  try { set = String(game.settings.get(MODULE_ID, "destrThreads") ?? "auto"); } catch { /* not registered yet */ }
  if ( set !== "auto" ) return Math.max(1, Math.min(8, Number(set) || 2));
  const cores = globalThis.navigator?.hardwareConcurrency ?? 4;
  let n = Math.max(2, Math.min(8, cores - 2));
  const saving = battery && !battery.charging && battery.level < 0.25;
  if ( perfLow() || document.visibilityState === "hidden" || saving ) n = 2;
  return n;
}

/* ---------------------------------------------------------------- re-baking a compatible older look (GM, in the background) */

/** "background" (default: when this tab is idle), "ask" (only on Rebake all), "now" (at load, as before). Client setting. */
export function rebakeMode() {
  try { const v = game.settings.get(MODULE_ID, "destrRebake"); return ["background", "ask", "now"].includes(v) ? v : "background"; } catch { return "background"; }
}
let lastInput = Date.now(), idleTimer = 0;
for ( const ev of ["pointerdown", "keydown", "wheel"] ) globalThis.addEventListener?.(ev, () => { lastInput = Date.now(); }, { passive: true, capture: true });
/** A few strokes at a time, only while nobody uses this tab (3 s without input, the tab visible, no other bake running). */
function scheduleIdleRebake(ms = 4000) {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = 0;
    if ( !S || !status.compat || rebakeMode() !== "background" ) return;
    if ( Date.now() - lastInput < 3000 || document.visibilityState !== "visible" || inflight ) return scheduleIdleRebake(2000);
    Trace.event("bake-idle", { left: status.compat.left });
    rebake({ awaitPublish: false, idle: true });
  }, ms);
}

/** The breaker tripped: no more automatic bakes or publishes on this client until "Bake now" (api.destruction.bakeNow) or a reload. */
function pauseBaking(kind, why) {
  const msg = game.i18n.localize("MOINENMAPS.Destr.bakePaused");
  Object.assign(status, { baking: false, waiting: false, paused: true, error: msg });
  Trace.event("breaker", { kind, why, tripped: breaker.tripped });
  console.warn(`${MODULE_ID} | destruction: ${kind} of the same strokes again and again (${why}) - automatic baking paused on this client`, breaker.tripped);
  tell("status");
}

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
  // (a manifest of 0.4.1 with the same settings counts as the same: its entries stay, rewritten with the version they were baked at)
  const M = Store.manifestOf(S), dir = Net.chunkDir(scene.id), same = M?.dir === dir && Store.sameBase(M.base, base, Store.legacyBaseKey(scene, S, bg));
  // (versions no longer decide who may publish: every entry carries the version it was baked with, and an entry is only replaced by a
  // record of the same stroke baked with a newer version, or by a changed stroke - never downgraded)
  seedKnown(scene);
  const c = {}, todo = [], FS = Store.sigsOf(S);
  for ( const [index, o] of S.objects.entries() ) {
    if ( o.k ) continue;
    const sig = FS[index].sig, r = recs.get(`${base}|${o.id}|${sig}`);
    if ( !r ) return;                                // should not happen once complete; a later run publishes
    const e = same ? Store.entryOf(M, o.id) : null;
    if ( e?.sig === sig && !((r.ver ?? -1) > (e.ver ?? -1) && r.id !== e.id) ) c[o.id] = Policy.entryString(sig, e.id, e.ver);
    else if ( r.id && Net.known(dir).has(r.id) ) c[o.id] = Policy.entryString(sig, r.id, r.ver ?? CORE_VERSION);
    else todo.push({ o, sig, r });
  }
  const stale = M ? Object.keys(M.c).filter((id) => !(id in c) && !todo.some((q) => q.o.id === id)) : [];
  if ( !todo.length && same && !stale.length && Object.keys(c).every((id) => M.c[id] === c[id]) && M.key === key ) return;
  if ( !breaker.hit("publish", key) ) { pauseBaking("publish", "manifest keeps changing"); return; }
  Trace.event("publish", { n: todo.length, of: Object.keys(c).length + todo.length, over: M?.base ?? null })
  try {
    if ( Date.now() < publishRetryAt ) { schedulePersist(0); return; }
    if ( todo.length ) {
      const t = performance.now();
      // (a record that let go of its pixels - a chunk of another folder, a copied scene - gets them back to be encoded here)
      const dryOnes = todo.filter((q) => q.r.sprites.lean || q.r.shell);
      if ( dryOnes.length && !(await Promise.all(dryOnes.map((q) => hydrate(q.r)))).every(Boolean) ) { schedulePersist(0); return; }
      const out = await Net.job({ kind: "objects", F: META_FIELDS, objs: todo.map((q) => ({ key: q.o.id, sprites: q.r.sprites })) });
      status.perf.encode = Math.round(performance.now() - t);
      const byKey = new Map(out.map((e) => [e.key, e]));
      for ( const q of todo ) {
        const e = byKey.get(q.o.id);
        q.r.id = e.id; q.r.dir = dir;
        c[q.o.id] = Policy.entryString(q.sig, e.id, q.r.ver ?? CORE_VERSION);
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
    for ( const [h, e] of entryLog ) if ( !keep.has(h) || ageOf(e.t, at) > 60000 ) entryLog.delete(h);
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
    scheduleComposite(800);      // (soon: players whose shells lost their bands with this change take the new composite)
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
  for ( const o of S.objects ?? [] ) S.dropOk?.add(o.id);          // on purpose: the save may delete them all (no snapshot)
  S.objects = []; Model.composite(S);
  edited(null);
  Editor.refreshOverlay();
}

/** Undo: the last stroke object goes; everything painted before it stays exactly as it was. */
export function undoLast() {
  if ( !S?.objects?.length ) return false;
  S.dropOk?.add(S.objects.at(-1).id);                               // on purpose (several undos within one save pause: each one)
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
  if ( !Object.keys(upd).length ) return;                            // nothing changed: no write
  await canvas.scene.update(upd);
  if ( Store.snapshotIn(upd) ) integrity(canvas.scene);               // a drop nobody asked for: say it (the snapshot is in the scene)
}

/* ---------------------------------------------------------------- API */

/**
 * Bring back strokes kept in the scene: `from` "v3" (the snapshot taken before a save dropped strokes nobody undid), "v2" (the copy
 * of the layout-2 array, written once with the scene's first layout-3 save) or "auto" (the snapshot when there is one). "merge"
 * (default): every kept stroke the scene lacks comes back after the strokes there are (nothing current is touched); "replace": the
 * scene's strokes become exactly the kept ones (strokes painted since are dropped - use only on purpose). Returns how many came back.
 */
export async function restoreBackup({ mode = "merge", from = "auto" } = {}) {
  if ( !game.user.isGM || !canvas.scene ) return 0;
  const s = ensureState(), back = Store.backupObjects(canvas.scene, s, from);
  if ( !back?.length ) { ui.notifications.warn(game.i18n.localize("MOINENMAPS.Destr.noBackup")); return 0; }
  const replace = mode === "replace";
  const have = new Set((replace ? [] : s.objects).map((o) => o.id));
  const add = back.filter((o) => !have.has(o.id));
  if ( replace ) for ( const o of s.objects ) s.dropOk?.add(o.id);
  else { let next = Model.nextSeq(s); for ( const o of add ) o.s = next++; }     // after the strokes there are, in their own order
  s.objects = replace ? add : [...s.objects, ...add];
  Model.composite(s); s.rev = Model.nextRev();
  editedHere = true;
  await save();
  integrity(canvas.scene);
  rebake(); Editor.refreshOverlay(); tell("edited");
  return add.length;
}

/** What a scene keeps (see restoreBackup): { v2: { at, n, ids }, v3: { at, n, gone } } (null where there is none). */
function backups(scene = canvas.scene) {
  const F = scene?.flags?.[MODULE_ID] ?? {}, B2 = F[Store.BACKUP], B3 = F[Store.SNAPSHOT];
  return { v2: B2 ? { at: B2.at, n: B2.n, ids: (B2.o ?? []).map((o) => o?.id) } : null, v3: B3 ? { at: B3.at, n: B3.n, gone: B3.gone ?? [] } : null };
}

export const destructionApi = {
  /** Substrates (substrate.mjs): how many strokes were swapped in silently because older damage under them changed. */
  substrate: () => ({ ...depStats }),
  backup: () => backups(),
  restoreBackup,
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
  /** Rebake all: the strokes in an older look baked again with the current code, in the background (rebakeStrokes); `ids`: some only. */
  rebakeAll: (ids = null) => { Trace.event("rebake-all"); return rebakeStrokes(ids); },
  rebakePause: (p = true) => rebakePause(p), rebakeCancel: () => rebakeCancel(),
  /** "Bake now": after the loop breaker paused this client (status.paused), bake and publish again. */
  bakeNow: () => { breaker.reset(); bakeFail = null; Object.assign(status, { paused: false, error: "" }); shownKey = ""; Trace.event("bake-now"); return rebake({ awaitPublish: false }); },
  state: () => S ? Model.encode(S) : null,
  // (records that let go of their pixels count by their chunk id - a hash of the same pixels and rows)
  status: () => { if ( lastRecs && !status.hash ) status.hash = lastRecs.some((r) => r.sprites.lean || r.shell) ? `c${Chunks.hashStr(lastRecs.map((r) => r.sprites.lean || r.shell ? r.id : Chunks.recordsHash([r])).join(","))}` : Chunks.recordsHash(lastRecs); return { ...status, key: shownKey, baked: S?.baked ?? null, inflight }; },
  /** Streaming counters (requests, bytes, IndexedDB hits, uploads) and the chunk store's GC, for tests. */
  net: { reveal: () => ({ ...Reveal.stats }), trace: Trace.report, film: Trace.showFilm, stats: () => ({ ...Net.stats }), reset: Net.resetStats, debug: Net.debug, gc: (opts) => canvas.scene && Net.collectGarbage(canvas.scene.id, opts) },
  /** Every area enters again, locally. */
  // (the display asks for the pixels it lacks itself: an entry waits up to 150 ms for them - display.waitPixels)
  replay: () => (display?.pixelSource ? Promise.resolve(display.detonate(performance.now())) : pixelsForEntries().then(() => display?.detonate(performance.now()))),
  display: () => display,
  /** Tests: every area shown as a shell and the record behind it (composite.mjs; the composite harness). */
  shells: () => [...(display?.groups.values() ?? [])].filter((g) => g.shell).map((g) => { const r = shownRecs.get(g.objId);
    return { hash: g.hash, obj: g.objId, inRecs: [...recs.values()].filter((q) => q.objId === g.objId).map((q) => (q === r ? "=" : "") + (q.shell ? "shell" : q.sprites.lean ? "lean" : "px")).join(","), rec: r ? { has: Array.isArray(r.shell) ? r.shell.some((a) => a.h === g.hash) : null, hs: Array.isArray(r.shell) ? r.shell.map((a) => a.h).slice(0, 3) : null, shell: !!r.shell, lean: !!r.sprites?.lean, hydrating: !!r.hydrating, id: r.id ?? null, n: r.sprites?.length ?? 0 } : null }; }),
  TYPES: Model.TYPES, MATERIALS: Model.MATERIALS, CAUSES: Model.CAUSES
};

/** The Damage panel's buttons (section.mjs). */
export const bakeNow = () => destructionApi.bakeNow();
export const rebakeAll = (ids = null) => destructionApi.rebakeAll(ids);

export function registerDestruction() {
  moduleApi.destruction = destructionApi;
  Editor.bindHost({ state: () => S, ensureState, edited, undo: undoLast });
  Hooks.once("init", () => Editor.registerEditorSettings(() => tell("brush")));
  Hooks.once("init", () => game.settings.register(MODULE_ID, "destrRebake", {
    name: "MOINENMAPS.Destr.rebakeSetting", hint: "MOINENMAPS.Destr.rebakeSettingHint", scope: "client", config: true, type: String, default: "background",
    choices: { background: "MOINENMAPS.Destr.rebake.background", ask: "MOINENMAPS.Destr.rebake.ask", now: "MOINENMAPS.Destr.rebake.now" }
  }));
  Hooks.once("init", () => game.settings.register(MODULE_ID, "destrThreads", {
    name: "MOINENMAPS.Destr.threadsSetting", hint: "MOINENMAPS.Destr.threadsSettingHint", scope: "client", config: true, type: String, default: "auto",
    choices: Object.fromEntries([["auto", "MOINENMAPS.Destr.threadsAuto"], ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => [String(n), String(n)])])
  }));
  Hooks.on("canvasReady", onCanvasReady);
  Hooks.on("canvasTearDown", teardown);
  Hooks.on("updateScene", onUpdateScene);
  Hooks.once("ready", () => { const m = game.modules.get(MODULE_ID); if ( m ) { m.api ??= moduleApi; m.api.destruction ??= destructionApi; } Store.dropOldCache(); Composite.D.flood = destructionApi.flood ?? null; });
  Composite.registerSetting();
  window.addEventListener("beforeunload", () => { flushSave(); disposeBaker(); });
  document.addEventListener("visibilitychange", () => { if ( document.visibilityState === "hidden" ) flushSave(); });
}
