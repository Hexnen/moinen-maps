/* LMAP / FXLM: COMIC SOUND EFFECTS of the map's destruction and fire, the runtime. What sounds (sfx-core.mjs plans it):
     - a damage area entering (destruction display.enter, through sfx/bus.mjs): every client plays the same entry (the scene flag's
       entries, a preset's shared clock, a cinematic show, a Detonate), so every client letters it too;
     - the fire layer's strokes (fire.mjs; the same strokes and the same shared clock on every client): a fire catching (when its
       flames show: MAPSFXSEAT lettered at the shared moment + CATCH_SHOW_MS on every seat), flaring up, going out, an explosion, ground dust, an eraser dousing fire;
     - a burning fire's sound for as long as it burns (MAPBURN2: in LINES - one word of its score at a time, an area of the map at
       most one a turn, beside its flames; sfx-burn.mjs), riding the flame front while it runs along its path, its words following the fire's level.
   Nothing is networked: the same events with the same seeds (the scene id + the event's key) give the same words everywhere; no
   per-client memory changes a word (FXLM 14).
   Words come from the engine's own vocabulary (L.word: the kind, loudness and duration of the sound), its look follows the sound, its
   motion the staging asked by sfx-core (a cave-in drops, a bomb shoves the words around it aside, a car's word rides with the car).
   Placement (MAPSFXSEAT: one picture for the whole table): planned ONCE from shared data only (sfx-table.mjs: a reference window and
   zoom, tokens whose documents are not hidden, pins every player may see, the table's own word ledger, the shared clock), sized by the
   engine's size model on that reference view (world size, the same everywhere), measured by the engine itself (L.measure: hold box +
   reach in cap heights), beside what it letters, off tokens, pins and other words; played at the shared instant (startAt: a late seat
   joins mid-life). Then the seat rule (MAPSFXSEAT2, sfx-seat.mjs seatLayout: the size this seat's window and zoom give the word at
   step 2, then the step's share; the table's side of the thing, moved the least to stand clean - farther away but clean) and the
   seat's own needs (scale setting, reduced motion, perf caps, "big only", what it may see). An unlocated word - thunder - is laid out
   once in the reference window, then centred into this window and laid out the same way. api.sfx.log() lists every call with its
   seat rule.
   Settings (GMALLMAPS: all the TABLE's, world, written by a GM only, live on every seat; sfx-prefs.mjs, window sfx-table-ui.mjs, menu
   "Comic sound effects on the map" in the module's settings): "sfxLetters" (all / big only / off; was a client setting next to the
   world switch "sfxLettersWorld", which the migration folds in), "sfxWordsWorld" (the word set, "en" / "pl", named by a GM's seat - MAPWIN:
   never a seat's own interface language; a seat's own override "sfxWords" is gone), "sfxLayer" (was a client setting); SFXSIZE: "sfxSizeDestruction" / "sfxSizeFire" / "sfxSizeWeather" (0 none, 1 smaller,
   2 today's size, 3 bigger; sfx-size.mjs). Each seat's own: its performance mode (fewer side words up) and reduced motion (the
   module's own rule, config.reducedMotion, passed on). */
import { MODULE_ID, reducedMotion } from "../config.mjs";
import { api as moduleApi } from "../attrs.mjs";
import { perfMode } from "../perf-mode.mjs";
import { sharedNow } from "../shared-clock.mjs";
import { letters } from "../letters/index.mjs";
import { sfxBus } from "./bus.mjs";
import * as C from "./sfx-core.mjs";
import * as FM from "../fire/model.mjs";
import * as DM from "../fire/dust-model.mjs";
import * as Fire from "../fire/fire.mjs";
import { pathTimes } from "../destruction/entry-clock.mjs";
import { causeLook } from "../destruction/cause-fx.mjs";
import * as A from "../presets/accents-core.mjs";
import * as PG from "./sfx-page.mjs";
import * as MC from "../presets/meteor-core.mjs";
import { fallAt as landingFallAt } from "../presets/landing-fx.mjs";
import * as EV from "./sfx-events.mjs";
import * as SZ from "./sfx-size.mjs";
import * as PF from "./sfx-prefs.mjs";
import * as UI from "./sfx-table-ui.mjs";
import * as FIT from "./sfx-fit.mjs";
import * as SEAT from "./sfx-seat.mjs";
import * as T from "./sfx-table.mjs";
import * as PLAN from "./sfx-plan.mjs";
import * as BURN from "./sfx-burn.mjs";
import * as DIR from "./sfx-direct.mjs";
import { mapPixels } from "../destruction/source.mjs";
import { buildTimeline } from "../tokens/carry-core.mjs";
import { hitsOf } from "../tokens/plough-core.mjs";

const MAX_AHEAD = 120000;      // events further ahead than this (a preset timed minutes ahead) are not scheduled
const CLOCK_OK = 30, CLOCK_WAIT = 20000;  // ms: a seat's shared clock error a run joins on; how long after load a run waits for it
const BURN_AFTER = 1500;       // ms after a fire shows before its continuous sound starts (the catch word has the stage first)
const CATCH_SHOW_MS = T.CATCH_SHOW_MS;   // MAPSFXSEAT: a catch word sounds this long after its fire's shared moment (question MAPSFXSEAT-2)
const UI_MS = 400;             // the interface rectangles are measured at most this often
const UI_VISIT = 6000;         // the most page elements that walk visits (MAPEDGE: 900 missed the party panel)
// a live fire's lasting word: the engine's sustain treatments WITHOUT "echo" (EFFECTS1, live: the echo copies sat stacked on
// the word itself, FOOOFF three times over one fire)

let L = null, loading = null, gen = 0;      // gen: the scene's generation (a scene change makes every waiting callback stale)
// MAPSFXSEAT: the size model of the engine copy this page RUNS (its own scripts/letters/size.mjs, from the copy the registry chose: maybe
// plus-ultra's) - the table sizes are its model fed the reference view (engine request MAPSFXSEAT-E3: L.sizeOf with an explicit view)
let engineSizeFor = null;
let known = null;              // the engine's sound kinds
let pending = [], gatherTimer = 0;
const sched = new Map();       // key -> { id, obj, voice }: timers of events and words scheduled ahead
const gated = new Map();       // fire stroke id -> [events waiting for its flames to show]
const shownAt = new Map();     // fire stroke id -> performance.now() when its flames first showed here
const seenEntry = new Map();   // area hash|start -> ms (an area waiting for its pixels enters twice)
const seenEvent = new Set();   // event keys already played or scheduled here
const alive = new Set();       // { box, h, obj } words of this module on screen
const burns = new Map();       // burn key -> { plan, live, idx (the spots lettered here), all (the table's), off (this seat's rooms), subs: [the words up] }
let burnOrder = [];            // MAPBURN2: the burn keys in the table's order (the biggest fire first): the voices of the areas
const spoken = new Map();      // MAPBURN2: `${area}|${turn}` -> the line's shared instant: an area's line is lettered once
const burnLog = [];            // MAPBURN2: the last lines of this seat (api.sfx.burnLines(): two seats compare)
let fireSeen = new Map();      // fire stroke id -> the stroke as last seen
let burnTimer = 0;
let lastPlaced = [];          // the last words placed here (for checks: text, role, scene box, penalties)
let recent = [];               // main words played lately (an echo of one is not lettered again)
let shooters = [];             // gun firings from a token here: { pts (where its rounds land, scene px), t1 (perf ms) }
let uiCache = { t: -1e9, rects: [] };
// EFFECTS1: preset firings told as one page each (sfx-page.mjs): fid -> { rec, pg, ground }; what their strokes letter by
// themselves is silent (owned): the page speaks for them
const pages = new Map();
let owned = { d: new Set(), f: new Set(), catch: new Set(), out: new Map() };
let firingsSeen = null;        // the scene flag's firing records object last scanned
// EFFECTS2: a Detonate going off (its shared start: its areas' own entries are silent, its composition speaks), ploughs lettered here,
// the rain's lightning (flashes lettered here, the far ones counted from the storm's switch-on)
let detonating = null;         // { start, until } (performance clock)
const ploughs = new Set();     // stroke id|start of the ploughs lettered here
let soon = [];                  // boxes of words placed, not started yet ({ box, until })
let stormTimer = 0;
const flashSeen = new Set();
let farCount = { key: "", list: new Map() };
// MAPTHUNDER (ADVM r2 items 1, 9): the storm under the fight
const fights = new Map();       // key -> shared ms of a fight's main word (a bomb's, a fire's catch, a brush blast, a gun): a storm word yields to it
const stormUp = new Set();      // engine handles of storm words up on this seat (they leave before a fight's word lands)
let closeMemo = { key: "", rp: null, m: new Map() };   // slot -> does it hold a close strike (the storm's settings as keyed)
const onsetSeen = new Set();    // storm switch-on moments whose entrance was decided here
const steamSeen = new Set();    // weather keys whose rain-on-fire hiss was decided here
// MAPSFXSEAT: the table picture (sfx-seat.mjs): the words every seat holds, planned from shared data; and this seat's own log of every
// lettering call (what it drew, where, how big, when, by which seat rule) for the checks and the two-seat takes
const tableLedger = SEAT.makeLedger();
// MAPPLAN: a page's table picture is planned in slices of a few ms (sfx-plan.mjs, `plans` below) instead of one task of 44-75 ms at its
// firing. The pictures still in flight are finished before anything else writes the ledger (plans.settle), and a reader gets the ledger
// as the whole picture will leave it for the time it asks about (plans.read): every reader sees what a page planned at once left, and
// the words come into the ledger in the same order on every seat.
const ledger = {
  get list() { plans.settle(); return tableLedger.list; },
  add: (e) => { plans.settle(); return tableLedger.add(e); },
  boxes: (t0, t1, skip) => plans.read(t0, t1, (l) => l.boxes(t0, t1, skip)),
  count: (t0, t1) => plans.read(t0, t1, (l) => l.count(t0, t1)),
  has: (k) => { plans.settle(); return tableLedger.has(k); },
  get: (k) => { plans.settle(); return tableLedger.get(k); },
  prune: (now) => { plans.settle(); tableLedger.prune(now); },
  clear: () => { plans.clear(); tableLedger.clear(); }
};
let seatLog = [];
let screenUp = [];              // MAPSFXSEAT2: this seat's unlocated words still up ({ box (CSS px), life [t0, t1] shared ms }): a new one keeps off them
const holdMemo = new Map();     // word + look -> the engine's hold box (a page plans many words in one frame)
const pageWaits = new Map();    // firing id -> the shared moment its page stops waiting for its strokes
const KNOCK_CONTACT = 60;       // MAPDIRECT: a knocked word's contact (ms after its start) until its handle tells its own
const PAGE_WAIT_MS = 4000;      // a page waits this long (shared ms after its firing's moment) for all its fire-layer strokes
const stats = { events: 0, clusters: 0, words: 0, dropped: 0, late: 0, stale: 0, ms: 0, uiMs: 0, burns: 0,
  // (MAPPLAN: a page's planning in slices - units run, their ms and the longest; the longest slice; the times a word or another reader of
  // the ledger had to finish a picture at once, and the longest such stretch; the times a reader had a part of one planned for it)
  planN: 0, planMs: 0, planMax: 0, sliceMax: 0, planForced: 0, planForcedMax: 0, planPeek: 0, planPeekMax: 0 };

/* ---------------------------------------------------------------- settings */

const get = (k, d) => { try { return game.settings.get(MODULE_ID, k); } catch { return d; } };
// (GMALLMAPS: every value is the TABLE's - world settings the GM writes; no seat override any more)
export const mode = () => PF.clean("sfxLetters", get("sfxLetters", "all"));
// (every seat must see the same word for the same moment: the WORLD's word set alone. MAPWIN: a set no GM's seat has named yet ("auto")
// is the shared one on every seat, never this seat's interface language - sfx-prefs wordsOf; fixWords names it)
const lang = () => PF.wordsOf(get("sfxWordsWorld", "auto"));
// SFXSIZE: the size step of a group's lettering (sfx-size.mjs; world settings, the GM's for the table: every seat letters the same)
export const stepFor = (g) => SZ.stepOf(get(SZ.SIZE_SETTING[g], SZ.SIZE_DEFAULT));
const grpOf = T.grpOf;

function registerSettings() {
  const T = (k) => `MOINENMAPS.Sfx.${k}`;
  // GMALLMAPS: every option of the map's lettering is the TABLE's: world scope, the GM's (restricted; a player's write is cancelled on
  // his seat: guardWrite), live on every seat (onChange; a reset deletes the document: deleteSetting), shown in ONE window for everyone
  // (sfx-table-ui.mjs, menu below; config: false keeps them out of Foundry's list, where a player would not see them at all)
  const live = (fn) => () => { fn?.(); UI.follow(); };
  game.settings.register(MODULE_ID, "sfxLetters", { name: T("set"), hint: T("setHint"), scope: "world", config: false, restricted: true, type: String, default: "all",
    choices: { all: T("all"), big: T("big"), off: T("off") }, onChange: live(() => refresh()) });
  // SFXSIZE: the lettering's size per group, chosen by the GM for the table (0 none, 1 smaller, 2 today's size, 3 bigger); live
  for ( const g of SZ.SIZE_GROUPS ) game.settings.register(MODULE_ID, SZ.SIZE_SETTING[g], { name: T(`size.${g}`), hint: T(`size.${g}Hint`), scope: "world", config: false,
    restricted: true, type: Number, default: SZ.SIZE_DEFAULT, range: { min: 0, max: 3, step: 1 }, onChange: live(() => sizeChanged(g)) });
  // (the lettering engine's world layers, LETR contract v3; the next word takes the new layer)
  game.settings.register(MODULE_ID, "sfxLayer", { name: T("layer"), hint: T("layerHint"), scope: "world", config: false, restricted: true, type: String, default: "overlay",
    choices: Object.fromEntries(LAYER_IDS.map((k) => [k, T(`layers.${k}`)])), onChange: live() });
  game.settings.register(MODULE_ID, "sfxWordsWorld", { name: T("wordsWorld"), hint: T("wordsWorldHint"), scope: "world", config: false, restricted: true, type: String, default: "auto",
    choices: { auto: T("wordsAuto"), en: T("wordsEn"), pl: T("wordsPl") }, onChange: live(() => fixWords()) });
  game.settings.register(MODULE_ID, PF.MIGRATED_KEY, { scope: "world", config: false, type: Number, default: 0 });
  game.settings.registerMenu(MODULE_ID, "sfxTable", { name: T("table.menu"), label: T("table.open"), hint: T("table.menuHint"), icon: "fa-solid fa-burst",
    type: UI.TableMenu, restricted: false });
}

/** The engine's world layers (LETR contract v3), bottom to top (sfx-prefs.mjs). */
export const LAYER_IDS = PF.LAYER_IDS;
const layerOpts = () => { const k = get("sfxLayer", "overlay"); return { layer: LAYER_IDS.includes(k) ? k : "overlay" }; };

/* ---------------------------------------------------------------- the engine */

function engine() {
  if ( L ) return L;
  // (once loaded: what waits in this scene is gathered at once; teardown empties `pending`, so another scene's events never come back)
  loading ??= letters().then(async (e) => {
    L = e; try { known = new Set((L.vocab?.list?.("en") ?? []).map((k) => k.id)); } catch { known = null; }
    engineSizeFor = await servingSizeFor(e);
    if ( pending.length && !gatherTimer ) gatherTimer = setTimeout(flush, 0);
    scheduleBurn(0);
    return e;
  }).catch((err) => { console.warn(`${MODULE_ID} | sfx: the lettering engine did not load`, err); loading = null; return null; });
  return null;
}

/** MAPSFXSEAT: the size model (sizeFor) of the engine copy the page runs: the registry's copy of the same VERSION and module (L.build) */
async function servingSizeFor(e) {
  try {
    const all = globalThis.MoinenLetters?.copies ?? [], m = e?.build?.module;
    const c = all.find((q) => q.version === e.version && (!m || String(q.base).includes(`/${m}/`))) ?? all.find((q) => q.version === e.version);
    if ( !c?.base ) return null;
    const mod = await import(new URL("./size.mjs", c.base).href);
    return typeof mod.sizeFor === "function" ? mod.sizeFor : null;
  } catch { return null; }
}

/* ---------------------------------------------------------------- events in */

const grid = () => canvas?.grid?.size || 100;
/** a shared-clock moment -> this page's performance clock */
const toPerf = (t) => performance.now() + (t - sharedNow());
/** this page's performance-clock moment -> the shared clock */
const toShared = (t) => sharedNow() + (t - performance.now());
const later = (key, ms, fn, info = {}) => {
  const g0 = gen;
  const id = setTimeout(() => { sched.delete(key); if ( g0 === gen ) fn(); }, Math.max(0, ms));
  const old = sched.get(key); if ( old ) clearTimeout(old.id);
  sched.set(key, { id, ...info });
};
/** Cancel what is scheduled for a fire stroke (it went out, was erased or removed): its catch / flare words, never its out hiss. */
function cancelObj(obj) {
  for ( const [k, s] of sched ) if ( s.obj === obj && /^(fire|flare)$/.test(s.voice) ) { clearTimeout(s.id); sched.delete(k); }
  gated.delete(obj);
  pending = pending.filter((e) => !(e.obj === obj && /^(fire|flare)$/.test(e.voice)));
  // a catch / flare word still up over a fire that is gone leaves now (its exit)
  for ( const a of alive ) if ( a.obj === obj && /^(fire|flare)$/.test(a.voice) ) { try { a.h.stop(); } catch {} }
}

/** An event at performance-clock time `t` (sfx-core EVENT): scheduled, gathered with its moment's other events, then played. */
export function add(e) {
  if ( mode() === "off" || !canvas?.ready ) return;
  // (SFXSIZE: a group at size 0 letters nothing: its events are not even scheduled)
  if ( stepFor(SZ.groupOfVoice(e.voice)) === 0 ) return;
  if ( isOwned(e) ) { stats.owned = (stats.owned ?? 0) + 1; return; }
  if ( seenEvent.has(e.key) ) return;
  seenEvent.add(e.key);
  if ( seenEvent.size > 4000 ) { const it = seenEvent.values(); for ( let i = 0; i < 1000; i++ ) seenEvent.delete(it.next().value); }
  stats.events++;
  // (MAPSFXSEAT: a fire's catch is lettered at its shared moment on every seat. Before, it waited until its flames showed HERE - the
  // field is computed in a worker, a busy seat shows a big fire a second or two later - so each seat lettered it at another instant, and
  // a seat still applying a blast dropped it as too late: the player got no catch word in the GM's window. Question MAPSFXSEAT-2)
  if ( e.gate ) e = { ...e, t: e.t + CATCH_SHOW_MS };
  // (MAPTHUNDER: a loud event of the fight - a blast, a crash, a gun, a fire catching, a brush stroke's zap - takes the stage from the storm)
  if ( (C.VOICES[e.voice]?.prio ?? 0) >= FIGHT_PRIO ) noteFight(`e|${e.key}`, toShared(e.t));
  const due = C.dueAt(e) - performance.now();
  if ( e.t - performance.now() > MAX_AHEAD ) return;
  if ( due > 30 ) { later(e.key, due, () => queue(e), { obj: e.obj, voice: e.voice, ev: e }); return; }
  queue(e);
}
function queue(e) {
  if ( isOwned(e) ) { stats.owned = (stats.owned ?? 0) + 1; return; }
  pending.push(e);
  engine();
  if ( !gatherTimer ) gatherTimer = setTimeout(flush, Math.max(0, Math.min(C.GATHER_MS, C.dueAt(e) + C.GATHER_MS - performance.now())));
  warmMoment();
}
/** MAPPLAN: while a moment's events are gathered (GATHER_MS), in idle slices: the engine settles the words the moment is about to be
    planned with (sfx-table warmMoment: nothing placed, nothing written - only the engine's own settle memo fills, which the flush's
    planning, measures and plays then reuse) and this seat's panels are read when the walk kept would be too old at the flush. Live
    2026-11-16 a flush was one task of 22-45 ms. An event that joins the moment starts it again; the flush ends it. */
let warmGen = 0;
function warmMoment() {
  const g0 = gen, w0 = ++warmGen;
  let it = null, ui = false;
  const idleRun = (fn) => { try { if ( typeof requestIdleCallback === "function" ) { requestIdleCallback(fn, { timeout: 8 }); return; } } catch { /* below */ } setTimeout(fn, 4); };
  const run = () => {
    if ( g0 !== gen || w0 !== warmGen || !L || !pending.length || mode() === "off" || !canvas?.ready ) return;
    const t0 = performance.now();
    try {
      if ( !ui ) { ui = true; if ( t0 + C.GATHER_MS + 30 - uiCache.t >= UI_MS ) { uiBoxes(true); idleRun(run); return; } }
      // (the events as copies, a memo and a `recent` of its own, the ledger only read - and not settled: a page in flight is not hurried)
      it ??= T.warmMoment(T.moments(pending.map((e) => ({ ...e })))[0] ?? [], { ...tdeps(), ledger: { count: (...a) => tableLedger.count(...a), boxes: (...a) => tableLedger.boxes(...a), add: () => null }, memo: new Map(), warn: () => {} }, recent.map((r) => ({ ...r })));
      while ( !it.next().done ) if ( performance.now() - t0 > 4 ) { idleRun(run); return; }
    } catch { /* the flush plans it */ }
  };
  idleRun(run);
}

/** Fire: a stroke's flames are on screen here (fire.mjs draw, through the bus): its waiting catch word goes, its sound may start. */
function onFireShown(ids) {
  const now = performance.now();
  let fresh = false;
  for ( const id of ids ) {
    if ( shownAt.has(id) ) continue;
    fresh = true;
    shownAt.set(id, now);
  }
  if ( shownAt.size > 400 ) for ( const [k, t] of shownAt ) if ( now - t > 600000 && !(Fire.allStrokes?.() ?? new Map()).has(k) ) shownAt.delete(k);
  if ( fresh ) scheduleBurn(BURN_AFTER + 50);
}

/** Destruction: a damage area enters (display.enter: any path, played, faded or off screen). */
function onEntry(d, g, opts, start) {
  const I = g?.info; if ( !I?.rect || !d?.origin ) return;
  scanFirings();
  // (a Detonate's areas: its composition letters them, once - EFFECTS2)
  if ( detonating && Math.abs(start - detonating.start) < 60 && performance.now() < detonating.until ) { stats.detOwned = (stats.detOwned ?? 0) + 1; return; }
  // (a Superhero plough: its own story - bite, grind, stop - instead of the stroke's word riding the front; EFFECTS2)
  if ( g.objId && onPlough(d, g, start) ) return;
  // (a damage area of a preset firing told as a page: silent - its ground tells the page what the debris lands on)
  // (MAPSFXSEAT: its ground is read from the map when the page is planned, the same on every seat - not from the first area to enter here)
  if ( g.objId && owned.d.has(g.objId) ) return;
  const k = `${g.hash}|${Math.round(start / 100)}`;
  if ( seenEntry.has(k) ) return;
  const pn = performance.now();
  seenEntry.set(k, pn);
  if ( seenEntry.size > 600 ) for ( const [kk, t] of seenEntry ) if ( pn - t > 20000 ) seenEntry.delete(kk);
  const ap = d.ap || 1, o = d.origin;
  const isGun = !!opts.path && !!g.objId && !!d.dropsOut?.(g.objId);
  const speed = d.look?.speed || 1, k2 = 1 / speed;
  const p0 = opts.path?.[0] ?? opts.o ?? null;
  // a gun's rounds: its walk (the path's own hit moments, ms from the start) for a stream of syllables along it
  const walk = isGun && opts.path.length > 1 ? opts.path.map((q) => ({ x: o.x + q[0] * ap, y: o.y + q[1] * ap, ms: (q[2] || 0) * (opts.strict ? 1 : k2) })) : null;
  // a stroke painted along its direction (directional on): its front runs the brush path at the drawing speed (entry-clock.mjs
  // pathTimes, the same clock the pixels use) - its word rides that front, along the stroke, for as long as it runs
  let ride = null;
  if ( !walk && !opts.simul && Array.isArray(opts.path) && opts.path.length > 1 ) {
    try { const pf = pathTimes(opts.path, k2 * (causeLook(I.cause)?.slow ?? 1)); if ( pf ) ride = C.rideOf(pf, o, ap, 40 * k2); } catch { ride = null; }
  }
  // (rounds fired by a token: its report sounds at the muzzle (onFiring); here, where they land, the impact on what they hit)
  const shooter = walk ? hasShooter(walk, pn) : null, shot = !!shooter;
  const ev = C.entryEvent(I, o, ap, start, { speed, gun: walk, ride, shot, key: `d|${g.hash}|${Math.round(start)}`, sid: `d|${g.hash}`, objId: g.objId ? `d${g.objId}` : null,
    from: p0 ? { x: o.x + p0[0] * ap, y: o.y + p0[1] * ap } : null });
  // MAPDIRECT: the rounds' impacts fly the same slant along the aim as the report at the barrel (sfx-direct streamDir: one line from the
  // shooter through the target and on); a shooter this seat may not see gives no direction here (it would point back at him); a gun
  // with no shooter on the map: along its own walk (the way the burst sweeps)
  if ( walk ) {
    const c = walk[Math.floor(walk.length / 2)], a = walk[0], b = walk.at(-1);
    const dir = shooter?.from ? (shooter.seen ? DIR.streamDir(c.x - shooter.from[0], c.y - shooter.from[1]) : null) : Math.hypot(b.x - a.x, b.y - a.y) >= grid() ? DIR.streamDir(b.x - a.x, b.y - a.y) : null;
    if ( Number.isFinite(dir) ) ev.dir = dir;
  }
  add(ev);
  // (EFFECTS2: a big blast or cave-in throws debris that lands after it, by the ground's material)
  for ( const f of C.brushFalls(ev, grid(), k2 * (causeLook(I.cause)?.slow ?? 1)) ) add(f);
}

/** A gun's pocks are a shooter's rounds (a firing from a token here, lately): its first hit lands on one of the shooter's hits. */
function hasShooter(walk, now) {
  shooters = shooters.filter((q) => q.t1 > now);
  const g = grid(), w0 = walk[0];
  return shooters.find((q) => q.pts.some((h) => Math.hypot(h[0] - w0.x, h[1] - w0.y) < g * 0.75)) ?? null;
}
/** Presets: a gun firing from a token on the map (accent "muzzle" with its shooter): its REPORT at the barrel, a syllable per round as
    it leaves (hit time minus flight, presets/accents-core.mjs), and its rounds' pocks letter the IMPACT instead of the rattle. */
function onFiring(rec) {
  if ( mode() === "off" || !canvas?.ready || !rec ) return;
  planPage(rec);
  if ( stepFor("destruction") === 0 ) return;
  const G = grid(), flight = (L) => Math.min(A.BULLET_MAX, Math.max(A.BULLET_MIN, (L / G) / A.BULLET_SQ * 1000));
  const t0 = toPerf(Number(rec.t0) || sharedNow());
  let reported = false;
  (rec.pending?.accent ?? []).forEach((it, i) => {
    if ( it?.kind !== "muzzle" || !Array.isArray(it.from) || !it.hits?.length ) return;
    const last = Math.max(...it.hits.map((h) => h[2] || 0));
    shooters.push({ pts: it.hits.map((h) => [h[0], h[1]]), t1: t0 + last + 6000, from: [it.from[0], it.from[1]], seen: shooterSeen(it.from, it.fr) });
    reported = true;
    const e = C.muzzleEvent(it, { t0, grid: G, muzzleOf: A.muzzleOf, flight, key: `m|${rec.id}|${i}`, sid: `m|${rec.id}|${i}` });
    if ( !e ) return;
    noteFight(`m|${rec.id}|${i}`, toShared(e.t));                                // (MAPTHUNDER: a gun's report takes the stage)
    // (owner's answer 4: a shooter this client cannot see - hidden, out of vision, under the fog - is heard, but generally on the
    // screen, never at its place)
    if ( !shooterSeen(it.from, it.fr) ) { screenReport(e.path, e.t0, e.kp, `m|${rec.id}|${i}`); return; }
    add(e);
  });
  // owner's answer 2: a gun with no source token on the map is still heard - its report shown generally on the screen, its impacts
  // at the hits (the pocks then letter the impact by material, not a rattle drawn at the hits)
  const hits = rec.walk?.hits ?? [];
  if ( !reported && hits.length && !(rec.pending?.burst?.length) ) {
    const last = Math.max(...hits.map((h) => h[2] || 0)), first = Math.min(...hits.map((h) => h[2] || 0));
    shooters.push({ pts: hits.map((h) => [h[0], h[1]]), t1: t0 + last + 6000 });
    const walk = hits.map((h) => ({ x: h[0], y: h[1], ms: Math.max(0, (h[2] || 0) - first) })).sort((a, b) => a.ms - b.ms);
    noteFight(`m|${rec.id}|off`, toShared(t0 + first));                         // (MAPTHUNDER)
    screenReport(walk, t0 + first - 120, C.gunKinds(walk), `m|${rec.id}|off`);
  }
}

/* ---------------------------------------------------------------- EFFECTS2: plough, Detonate, lightning */

/** A story that is not a preset firing (a plough, a flash): a page of its own words, played like a firing's (pageWord). */
function storyPage(id, t0, words, ground = null, grp = null) {
  const p = { rec: { id, t0, size: 1 }, pg: { words }, ground, grp };
  // (MAPTHUNDER: a story of the fight - a plough's stop - takes the stage from the storm; the storm's own stories and a hiss do not)
  if ( !STORM_PAGE.test(id) && !id.startsWith("steam|") ) for ( const w of words ) if ( w.role === "main" ) noteFight(`st|${id}|${w.key ?? w.role}`, Number(w.t));
  for ( const w of words ) {
    const t = toPerf(w.t), lead = 140;
    if ( lifeOver({ ...w, t }) ) continue;
    later(`st|${id}|${w.key ?? w.role}`, t - lead - performance.now(), () => pageWord(p, w, t));
  }
  return p;
}
/** A Superhero plough entering (a carry stroke with pushed tokens: display.carry.ploughOf): its story, once per run. -> handled? */
function onPlough(d, g, start) {
  const pl = d.carry?.ploughOf?.(g.objId);
  if ( !pl ) return false;
  const key = `${g.objId}|${Math.round(start / 200)}`;
  if ( ploughs.has(key) ) return true;
  ploughs.add(key); if ( ploughs.size > 200 ) ploughs.delete(ploughs.values().next().value);
  if ( mode() === "off" ) return true;
  try {
    const k = (1 / (d.look?.speed || 1)) * (causeLook(g.info.cause)?.slow ?? 1);
    const tl = buildTimeline(pl.tk, { ...pl.geo, k }), hits = hitsOf(pl.tk);
    const fp = d.carry?.frontOf?.(g.objId), o = d.origin, ap = d.ap || 1, T = pl.tk.p?.[pl.tk.p.length - 1] || 0;
    // (the head's path: art px, ms of the stored run -> scene px, ms of this run)
    const front = Array.isArray(fp) && tl ? fp.map((q) => [o.x + q[0] * ap, o.y + q[1] * ap, T > 0 ? (q[2] / T) * tl.D : 0]) : null;
    const sh = sharedNow() + (start - performance.now());
    const words = EV.ploughPage({ hits, front, D: tl?.D ?? 0, k, start: sh, delay: 40 * k, grid: grid(), seed: `plough|${g.objId}` })
      .map((w) => ({ ...w, role: w.role === "stop" ? "main" : w.role === "bite" ? "pre" : "sec", story: w.role }));
    if ( words.length ) storyPage(`plough|${g.objId}|${Math.round(sh)}`, sh, words, C.matOf(g.info.mat));
    stats.ploughs = (stats.ploughs ?? 0) + 1;
  } catch ( err ) { console.warn(`${MODULE_ID} | sfx: a plough's words failed`, err); }
  return true;
}
/** A Detonate (display.detonate, through the bus): every area goes off again from `start` - one composed set of words. */
function onDetonate(d, start) {
  if ( mode() === "off" || !canvas?.ready || !d?.order?.length || stepFor("destruction") === 0 ) return;
  scanFirings();
  detonating = { start, until: performance.now() + Math.max(0, start - performance.now()) + 6000 };
  const evs = [];
  for ( const g of d.order ) {
    const I = g?.info; if ( !I?.rect || !d.origin ) continue;
    // (a preset firing's area goes off as its firing's main sound: one explosion)
    const ownedBy = g.objId ? [...pages.values()].find((p) => p.pg.owned.d.has(g.objId)) : null;
    const e = C.entryEvent(I, d.origin, d.ap || 1, start, { speed: d.look?.speed || 1, key: `det|${g.hash}|${Math.round(start)}`, sid: `det|${g.hash}`, objId: g.objId ? `d${ownedBy ? ownedBy.rec.id : g.objId}` : null });
    if ( ownedBy?.pg.main ) e.voice = { boom: "boom", grenade: "boom", thud: "thud", thunder: "thunder", shockwave: "whump" }[ownedBy.pg.main] ?? e.voice;
    evs.push(e);
  }
  const comp = EV.detonateComposition(evs, { grid: grid(), max: EV.DETONATE_MAX.high ?? 3, prio: (v) => C.VOICES[v]?.prio ?? 0 });
  stats.detonates = (stats.detonates ?? 0) + 1;
  for ( const e of comp ) add(e);
}
/** The rain's lightning shown here (weather api.stormDisplay: only while this client shows the storm): its flashes ahead, lettered. */
function pollStorm() {
  clearTimeout(stormTimer); stormTimer = 0;
  const g0 = gen;
  const again = (ms) => { stormTimer = setTimeout(() => { if ( g0 === gen ) pollStorm(); }, ms); };
  if ( mode() === "off" || !canvas?.ready || stepFor("weather") === 0 ) return again(2000);
  const W = moduleApi.weather, storm = W?.stormDisplay?.();
  if ( !storm || !L ) return again(1000);
  const now = sharedNow(), rect = canvas.dimensions?.sceneRect ?? canvas.dimensions?.rect, G = grid();
  for ( const ev of storm.all?.() ?? [] ) {
    const id = `${ev.k}|${ev.t}|${ev.kind}`;
    if ( flashSeen.has(id) || ev.t + 2500 < now || ev.t - now > 3000 ) continue;
    flashSeen.add(id); if ( flashSeen.size > 600 ) flashSeen.delete(flashSeen.values().next().value);
    if ( ev.kind === "far" && !EV.farLettered(ev, (k) => farBefore(storm, k)) ) continue;
    if ( mode() === "big" && ev.kind !== "close" ) continue;
    // (MAPTHUNDER, ADVM r2 item 1: in a storm a close strike was lettered at full size every few seconds, two at once, over the fight. Now
    // the storm's RHYTHM, the same on every seat (sfx-events thunderRhythm, from the storm's own slots): one close strike lettered in
    // THUNDER_GAP s, the first after a quiet spell OPENS it (its bigger word), the rest roll on under it; a mid flash's rumble only away from
    // a lettered strike. Every strike still lights the scene - only its word waits)
    let spell = null;
    if ( !ev.preview && ev.kind === "close" ) { spell = EV.thunderRhythm(ev.k, (j) => closeAt(storm, j)); if ( !spell.lettered ) { stats.flashQuiet = (stats.flashQuiet ?? 0) + 1; continue; } }
    if ( !ev.preview && ev.kind === "mid" && !EV.midLettered(ev.k, (j) => closeAt(storm, j)) ) { stats.flashQuiet = (stats.flashQuiet ?? 0) + 1; continue; }
    const place = W.stormModel?.placeOf?.(ev, rect, G);
    if ( !place ) continue;
    const w = EV.flashWord(ev, place, view(), canvas.scene?.id ?? "", spell);
    if ( !w ) continue;
    const r = G * 0.5;
    const p = storyPage(`flash|${id}`, ev.t, [{ ...w, key: w.role, ...(w.screen ? {} : { box: { x0: w.x - r, y0: w.y - r * 0.4, x1: w.x + r, y1: w.y + r * 0.4 }, side: C.h01(`${w.seed}|s`) < 0.5 ? -1 : 1 }) }], null, "weather");
    // (MAPRIDE: when its word is due, the flash is asked again with the storm as it stands THEN - the GM's change reaches his own seat at
    // once and a player's a moment later, so a seat that polled before the change and one that polled after decided differently)
    // (MAPTHUNDER: and a storm word whose moment is a fight's is not lettered - the fight has the stage; sfx-events thunderYields)
    if ( !ev.preview ) p.still = () => (!flashStill(ev) ? false : EV.thunderYields(w.t, fights.values()) ? "yield" : true);
    stats.flashes = (stats.flashes ?? 0) + 1;
  }
  stormEntrance(storm, now, rect, G);
  again(700);
}
/** MAPTHUNDER: a storm's own page (a flash's, its entrance's) */
const STORM_PAGE = /^(flash|onset)\|/;
/** MAPTHUNDER: does slot `j` of the storm shown here hold a close strike (storm-model flashOf, the same on every seat)? Kept per settings. */
function closeAt(storm, j) {
  const S = storm.S, SM = moduleApi.weather?.stormModel; if ( !S || !SM?.flashOf ) return false;
  const key = `${S.t}|${storm.seed}|${S.rate}|${S.near}|${S.on}|${S.prev?.on}|${S.prev?.rate}|${S.prev?.near}`;
  if ( closeMemo.key !== key || closeMemo.rp !== storm.rainP ) closeMemo = { key, rp: storm.rainP, m: new Map() };
  if ( closeMemo.m.has(j) ) return closeMemo.m.get(j);
  const v = SM.flashOf(S, storm.seed, j, storm.rainP)?.kind === "close";
  closeMemo.m.set(j, v);
  if ( closeMemo.m.size > 3000 ) closeMemo.m.delete(closeMemo.m.keys().next().value);
  return v;
}
/** MAPTHUNDER: does the storm letter a flash of its own (by its rhythm) with its moment in [t0, t1] (shared ms)? */
function stormLettered(storm, t0, t1) {
  const SM = moduleApi.weather?.stormModel; if ( !storm?.S || !SM?.flashOf ) return false;
  const slot = SM.SLOT || 1000;
  for ( let k = Math.floor(t0 / slot) - 1; k <= Math.floor(t1 / slot); k++ ) {
    const ev = SM.flashOf(storm.S, storm.seed, k, storm.rainP);
    if ( !ev || ev.t < t0 || ev.t > t1 ) continue;
    if ( ev.kind === "close" ? EV.thunderRhythm(k, (j) => closeAt(storm, j)).lettered : ev.kind === "mid" ? EV.midLettered(k, (j) => closeAt(storm, j)) : EV.farLettered(ev, (j) => farBefore(storm, j)) ) return true;
  }
  return false;
}
/** MAPTHUNDER, ADVM r2 item 9 (E: the first thunder word came 7 s after the lightning was switched on): the storm's ENTRANCE - when the
    GM switches the lightning on and it letters nothing of its own at once, a rumble rolls in at the screen's edge (sfx-events stormOnset:
    the same on every seat, from the stored switch-on). */
function stormEntrance(storm, now, rect, G) {
  const S = storm.S;
  if ( !S?.on || S.prev?.on || onsetSeen.has(S.t) || now > S.t + EV.ONSET_LAG + 2000 || now < S.t - 4000 ) return;
  onsetSeen.add(S.t);
  if ( onsetSeen.size > 50 ) onsetSeen.delete(onsetSeen.values().next().value);
  if ( mode() === "big" ) return;
  const o = EV.stormOnset(S, (t0, t1) => stormLettered(storm, t0, t1), storm.rainP);
  if ( !o ) return;
  const place = moduleApi.weather?.stormModel?.placeOf?.(o.ev, rect, G);
  const w = place && EV.flashWord(o.ev, place, view(), canvas.scene?.id ?? "");
  if ( !w ) return;
  const p = storyPage(`onset|${S.t}`, o.t, [{ ...w, key: w.role }], null, "weather");
  p.still = () => { const s2 = moduleApi.weather?.stormDisplay?.()?.S; return !(s2?.on && s2.t === S.t) ? false : EV.thunderYields(w.t, fights.values()) ? "yield" : true; };
  stats.onsets = (stats.onsets ?? 0) + 1;
}
/** MAPTHUNDER: a voice of this priority and up is the fight (a fire catching and up: not a crack, a hiss, a rumble) */
const FIGHT_PRIO = 6;
/** MAPTHUNDER: a fight's main word at shared ms `t`: the storm yields to it (thunderYields), and a storm word up on this seat leaves
    THUNDER_CLEAR ms before it lands (its exit) - the same moment on every seat */
function noteFight(key, t) {
  if ( !Number.isFinite(t) || fights.has(key) ) return;
  const now = sharedNow();
  fights.set(key, t);
  if ( fights.size > 40 ) for ( const [k, f] of fights ) if ( f < now - 15000 ) fights.delete(k);
  const at = toPerf(t - EV.THUNDER_CLEAR) - performance.now();
  if ( at > -200 ) later(`fx|${key}`, at, () => { for ( const h of [...stormUp] ) { try { h.stop(); } catch {} stormUp.delete(h); } });
}
/** a storm word's engine handle, kept while it is up (MAPTHUNDER) */
function keepStorm(w, h) {
  if ( !h || !STORM_PAGE.test(String(w?.page ?? "")) ) return;
  stormUp.add(h);
  Promise.resolve(h.finished).finally(() => stormUp.delete(h));
}
/** MAPTHUNDER, ADVM r2 item 9 (D 28 s: rain level 3 on a burning fire got no reaction): the weather changed - the moment its rain first
    steams over the fires (weather model fireWet, the world's: the same on every seat) is lettered as a hiss at the burning fires */
function onWeather(kind) {
  if ( kind !== "changed" && kind !== "loaded" && kind !== "params" ) return;
  try {
    if ( mode() === "off" || mode() === "big" || !canvas?.ready || stepFor("fire") === 0 ) return;
    const W = moduleApi.weather, P = W?.params?.(), M = W?.model;
    if ( !P?.on || !M?.fireWet || !M?.resolve || !Array.isArray(P.keys) ) return;
    if ( P.who === "gm" && !game.user?.isGM ) return;                            // (the weather hidden from the players: so is its hiss)
    const now = sharedNow(), steamAt = (t) => M.fireWet(M.resolve(P, t)).steam;
    for ( const s of EV.steamOnsets(P.keys.filter((k) => Number(k?.t) >= now - 20000), steamAt) ) {
      if ( steamSeen.has(s.key) || s.t < now - 1500 ) continue;
      steamSeen.add(s.key);
      if ( steamSeen.size > 100 ) steamSeen.delete(steamSeen.values().next().value);
      later(`steam|${s.key}`, toPerf(s.t) - 600 - performance.now(), () => steamFires(s, steamAt(s.t)));
    }
  } catch ( err ) { console.warn(`${MODULE_ID} | sfx: the rain's hiss failed`, err); }
}
/** the hiss at the (at most two biggest) fires burning at the rain's steam onset `s` (the table's fires, as the burn's) */
function steamFires(s, steam) {
  if ( mode() === "off" || !canvas?.ready ) return;
  const G = grid(), all = Fire.allStrokes?.() ?? new Map();
  const fires = [...all.values()].filter((st) => st.k === "fire" && FM.burningAt(st, s.t));
  if ( !fires.length ) return;
  const geo = Fire.geo(), FP = Fire.params0();
  const plans = C.burnGroups(fires, G).map((g) => C.burnPlan(g, { grid: G, catchMs: (st) => FM.catchMs(st, geo, FP), levelNow: (st, t) => FM.levelNow(st, Number.isFinite(t) ? t : undefined) }))
    .sort((a, b) => b.prio - a.prio).slice(0, 2);
  for ( const pl of plans ) {
    const w = EV.steamWord({ ...pl, points: [pl.at(0, s.t)] }, s.t, steam, canvas.scene?.id ?? "");
    if ( !w ) continue;
    const ids = pl.key.split("+");
    const p = storyPage(`steam|${s.t}|${pl.key}`, s.t, [{ ...w, key: "steam" }], null, "fire");
    p.still = () => ids.some((id) => { const st = Fire.allStrokes?.()?.get(id); return !!st && FM.burningAt(st, sharedNow()); });
    stats.steams = (stats.steams ?? 0) + 1;
  }
}
/** MAPRIDE: is a lightning flash still one this storm makes and letters, read with the storm's settings as they stand now on this seat (a
    switch-off that reached this seat after its poll: the flash is gone, on every seat alike)? No storm shown here: as polled. */
function flashStill(ev) {
  try {
    const storm = moduleApi.weather?.stormDisplay?.(), SM = moduleApi.weather?.stormModel;
    if ( !storm?.S || !SM?.flashOf ) return true;
    const now = SM.flashOf(storm.S, storm.seed, ev.k, storm.rainP);
    if ( !now || now.kind !== ev.kind || now.t !== ev.t ) return false;
    // (MAPTHUNDER: and still lettered by the storm's rhythm as it stands now)
    if ( ev.kind === "close" ) return EV.thunderRhythm(ev.k, (j) => closeAt(storm, j)).lettered;
    if ( ev.kind === "mid" ) return EV.midLettered(ev.k, (j) => closeAt(storm, j));
    return !!EV.farLettered(now, (k) => farBefore(storm, k));
  } catch { return true; }
}
/** How many far flashes the storm made in slot `k`'s window before it (sfx-events farIndex: the same on every seat; MAPRIDE - before, a
    count since the switch-on that restarted when a change reached this seat, so seats numbered one flash differently). */
function farBefore(storm, k) {
  const S = storm.S, SM = moduleApi.weather?.stormModel; if ( !S || !SM?.flashOf ) return 1;
  const key = `${S.t}|${storm.seed}|${S.rate}|${S.near}|${S.on}|${S.prev?.on}`;
  if ( farCount.key !== key ) farCount = { key, list: new Map() };
  if ( farCount.list.has(k) ) return farCount.list.get(k);
  const n = EV.farIndex(k, (j) => SM.flashOf(S, storm.seed, j, storm.rainP)?.kind === "far");
  farCount.list.set(k, n);
  if ( farCount.list.size > 2000 ) farCount.list.delete(farCount.list.keys().next().value);
  return n;
}

/* ---------------------------------------------------------------- preset firings as pages (EFFECTS1) */

/** Is an event a part of a firing told as a page (its burst / dust stroke, a fire's catch, a fire's arranged hiss)? */
function isOwned(e) {
  const o = e.obj; if ( !o ) return false;
  if ( /\|(burst|dust|shock|debris\d)$/.test(e.key ?? "") && owned.f.has(o) ) return true;
  if ( e.voice === "fire" && owned.catch.has(o) ) return true;
  if ( e.voice === "out" && owned.out.has(o) && String(e.key ?? "").endsWith(`|out|${owned.out.get(o)}`) ) return true;
  return false;
}
/** Every firing record of the scene gets its page (a late joiner, a reload, the record before its hook). */
function scanFirings() {
  const F = canvas?.scene?.flags?.[MODULE_ID]?.presetFirings;
  if ( !F || F === firingsSeen ) return;
  firingsSeen = F;
  for ( const rec of Object.values(F) ) if ( rec?.id && !pages.has(rec.id) ) planPage(rec);
}
/** The page of a firing: planned once ALL its fire-layer strokes are here (they come in the same scene update, maybe a moment later). */
function planPage(rec, tries = 0) {
  if ( !rec?.id || pages.has(rec.id) ) return;
  // MAPSFXSEAT: the firing's own strokes are silent from the moment its record is here. Before, they were silent only once its page was
  // planned, and a page waited about a second for its fire strokes: a seat that got them later (busy applying the destruction) planned a
  // page without its burst (the shock wave as the main word, VWOOOOMMFF!) or none, and lettered the firing's damage areas by themselves
  // (KA-TWOOOOMM at that seat's own size): other words than the seat beside it.
  // (MAPEDGE: only a firing that can HAVE a page - a gun's walk alone has none, and its pocks letter the impact where the rounds land,
  // sfx-page mayPage; before, the gun's areas were silenced too and a burst of gunfire lettered only its muzzle)
  if ( PG.mayPage(rec) ) {
    for ( const d of rec.d ?? [] ) if ( d?.id ) owned.d.add(d.id);
    for ( const e of rec.f ?? [] ) if ( e?.id ) { owned.f.add(e.id); owned.catch.add(e.id); }
  }
  const all = Fire.allStrokes?.() ?? new Map();
  const missing = (rec.f ?? []).some((e) => !all.has(e.id));
  // (the page waits for all its strokes as long as the firing can still be lettered: a part of a page is another page)
  pageWaits.set(rec.id, pageWaits.get(rec.id) ?? Math.max(Number(rec.t0) || 0, sharedNow()) + PAGE_WAIT_MS);
  if ( missing && sharedNow() < pageWaits.get(rec.id) ) { const g0 = gen; setTimeout(() => { if ( g0 === gen ) planPage(rec, tries + 1); }, 80); return; }
  pageWaits.delete(rec.id);
  let pg;
  try { pg = PG.firingPage(rec, { grid: grid(), strokes: all, wayOf: MC.wayOf, headAt: MC.headAt, fallAt: landingFallAt, lift: 0.5 }); }
  catch ( err ) { console.warn(`${MODULE_ID} | sfx: a firing's page failed`, err); return; }
  // (MAPSFXSEAT: the ground under the impact from the map's own pixels, the same on every seat, known before any word is written)
  const p = { rec, pg, ground: groundAt(rec) };
  pages.set(rec.id, p);
  // (MAPTHUNDER: a firing's main word takes the stage from the storm)
  for ( const w of pg.words ?? [] ) if ( w.role === "main" ) noteFight(`pg|${rec.id}|${w.key}`, Number(w.t));
  for ( const id of pg.owned.d ) owned.d.add(id);
  for ( const id of pg.owned.f ) owned.f.add(id);
  for ( const id of pg.owned.catch ) owned.catch.add(id);
  for ( const [id, o] of pg.owned.out ) owned.out.set(id, o);
  // (what the fire layer already queued for these strokes before the page came: dropped)
  pending = pending.filter((e) => !isOwned(e));
  for ( const [k, s] of sched ) if ( s.ev && isOwned(s.ev) ) { clearTimeout(s.id); sched.delete(k); }
  if ( mode() === "off" ) return;
  let first = Infinity;
  for ( const w of pg.words ) {
    if ( stepFor(SZ.groupOfPageWord(w)) === 0 ) continue;                                // (SFXSIZE: its group letters nothing)
    const t = toPerf(w.t), lead = 140;
    if ( lifeOver({ ...w, t }) ) continue;                                                 // (a late joiner: its whole life on the table is over)
    first = Math.min(first, t - lead);
    later(`pg|${rec.id}|${w.key}`, t - lead - performance.now(), () => pageWord(p, w, t));
  }
  // (MAPSAME cost: the table picture and this seat's layout of it made AHEAD of the first word, in an idle moment - not inside the frame
  // the first word starts in (live 2026-11-15 one layout took 114 ms on the player's seat at that frame). A camera moved since lays it
  // out again at the word, as before.)
  if ( Number.isFinite(first) ) later(`pg|${rec.id}|prep`, first - PREP_LEAD - performance.now(), () => idle(() => prepPage(p)));
}
/** how long before a page's first word its table and layout are made (ms; an idle moment within it) */
const PREP_LEAD = 500;
const idle = (fn) => { try { if ( typeof requestIdleCallback === "function" ) return requestIdleCallback(fn, { timeout: PREP_LEAD - 200 }); } catch { /* below */ } return setTimeout(fn, 0); };
/** MAPSAME: a page's table and this seat's layout of it for the current view, made ahead (groupLayout keeps it while the view holds).
    MAPPLAN: in slices of a few ms each (sfx-plan.mjs) - one idle task of the whole page was a long frame too. */
function prepPage(p) {
  try {
    if ( mode() === "off" || !L || !canvas?.ready || !pages.has(p.rec.id) ) return;
    if ( plans.job(p) ) plans.pump();
  } catch ( err ) { console.warn(`${MODULE_ID} | sfx: a page's layout failed`, err); }
}
/** MAPSFXSEAT: the ground at a firing's impact from the map's pixels (sfx-seat groundOfPixels: the destruction bake's own rule). */
function groundAt(rec) {
  try {
    const at = Array.isArray(rec?.at) ? { x: Number(rec.at[0]), y: Number(rec.at[1]) } : null;
    if ( !at || !Number.isFinite(at.x) || !Number.isFinite(at.y) ) return null;
    const r = canvas.dimensions?.sceneRect ?? canvas.dimensions?.rect ?? { x: 0, y: 0 }, R = Math.max(8, Math.round(grid() * 0.6));
    const box = { x0: Math.round(at.x - (r.x ?? 0) - R), y0: Math.round(at.y - (r.y ?? 0) - R), w: 2 * R, h: 2 * R };
    return SEAT.groundOfPixels(mapPixels(1, box), box.w);
  } catch { return null; }
}
/** MAPSFXSEAT: the TABLE picture of a page, planned once from what every seat shares (sfx-table planPage); a seat then shows each word
    by the seat rule only (pageWord -> play / playScreen). (MAPPLAN: all of it at once - what is left of a picture in flight.) */
function tablePage(p) {
  if ( p.table || !L ) return p.table ?? null;
  const j = plans.job(p);
  if ( j ) plans.settleJob(j);
  return p.table;
}
/* MAPPLAN (sfx-plan.mjs): a page's table picture and this seat's layout of it are made in slices of a few ms, in idle moments, instead of
   one task of 44-75 ms at a firing - the same picture, the same places, every word at its instant. This seat's part: */
const plans = PLAN.makePlans({
  ledger: tableLedger,
  now: () => performance.now(),
  idle: (fn, ms) => { try { if ( typeof requestIdleCallback === "function" ) { requestIdleCallback(fn, { timeout: ms }); return; } } catch { /* below */ } setTimeout(() => fn(null), Math.min(ms, 16)); },
  timer: (key, ms, fn) => later(key, ms, fn),
  untimer: (key) => { const s = sched.get(key); if ( s ) { clearTimeout(s.id); sched.delete(key); } },
  // (what every seat shares, as it stands NOW - a picture planned over several slices reads the same clock, steps, tokens and pins)
  deps: () => PLAN.frozenDeps(tdeps(), { ledger: tableLedger, off: toPerf(0), steps: new Map(SZ.SIZE_GROUPS.map((g) => [g, stepFor(g)])), tokens: sharedTokens(null), pins: sharedPins(null) }),
  snap: (grp) => laySnap(grp, mapView(), canvas.stage?.scale?.x || 1, L.prefs?.scale ?? 1),
  stats,
  warn: (m, err) => console.warn(`${MODULE_ID} | sfx: ${m}`, err)
});

/** One word of a page, at its moment, on THIS seat: the table's word, shown by the seat rule (its view, its panels, what it may see). */
function pageWord(p, w, t) {
  if ( mode() === "off" || !canvas?.ready ) return;
  if ( !L ) { engine(); return; }
  // (MAPPLAN: the page's table picture starts here when no idle moment started it - as before - and this word goes on as soon as its
  // part of it is planned; what this seat itself decides by - its words up, a storm word's own rule - is read now, as before)
  const here = { still: p.still ? p.still() : true, up: alive.size };
  plans.ask(p, p.pg.words.indexOf(w), t, () => pageWordNow(p, w, here), `pgw|${p.rec.id}|${w.key ?? w.role}`);
}
function pageWordNow(p, w, here) {
  if ( mode() === "off" || !canvas?.ready || !L ) return;
  const tb = p.table ?? p.job?.pl.table;
  if ( mode() === "big" && w.role !== "main" ) return;
  const grp = SZ.groupOfPageWord(w, p.grp);
  if ( stepFor(grp) === 0 ) return;
  const q = tb?.get(w.key);
  if ( !q ) return;
  const still = here.still;
  if ( still === false || typeof still === "string" ) { seatSkip(q, typeof still === "string" ? still : "gone"); return; }   // (MAPTHUNDER: "yield")
  if ( q.dropped ) { stats.dropped++; lastPlaced.push({ text: q.text, role: w.role, key: w.key, dropped: q.dropped, why: q.why }); trimPlaced(); return; }
  // (this seat's own need: its performance mode keeps fewer words up - never the main word)
  const caps = C.CAPS[perfMode()] ?? C.CAPS.high;
  if ( w.role !== "main" && here.up >= caps.alive ) { stats.dropped++; seatSkip(q, "perf"); return; }
  // (owner's answer 4: a sound whose source this seat cannot see - under the fog, out of vision, a hidden shooter - is shown generally
  // on the screen, never at the hidden place; a flash beyond this seat's view sounds at the edge toward it)
  if ( q.screenAt ) { playScreen(q, q.screenAt); return; }
  // (MAPSEATS3: a close strike's thunder (`heard`) is lettered at the strike on every seat - its flash lights the scene, the fog does
  // not hide it; question MAPSEATS3-4)
  if ( !q.heard && !hereVisible(q.sx ?? q.x, q.sy ?? q.y) ) { playScreen(q); return; }
  if ( w.from && !shooterSeen([w.from.x, w.from.y]) ) { playScreen(q); return; }
  play(q);
  // (MAPPLAN: the walk over this seat's panels - 5-9 ms - not inside the frame the word starts in: when the walk kept (UI_MS) would be
  // too old by the word's instant, it is made in an idle moment before it)
  const wait = q.t - performance.now();
  if ( wait > 30 && performance.now() + wait - uiCache.t >= UI_MS ) warmUi(wait - 25);
  lastPlaced.push({ text: q.text, role: q.role, voice: q.voice, page: p.rec.id, key: w.key, box: q.box, ...(q.fitK !== undefined ? { fitK: q.fitK } : {}), clean: FIT.isClean(q.pen) });
  trimPlaced();
}
/** this seat's panels read again in an idle moment within `ms` */
function warmUi(ms) {
  const g0 = gen, run = () => { if ( g0 === gen && canvas?.ready && mode() !== "off" ) { try { uiBoxes(true); } catch { /* at the word */ } } };
  try { if ( typeof requestIdleCallback === "function" ) { requestIdleCallback(run, { timeout: Math.max(1, ms) }); return; } } catch { /* below */ }
  setTimeout(run, Math.max(0, ms));
}
const trimPlaced = () => { if ( lastPlaced.length > 24 ) lastPlaced = lastPlaced.slice(-24); };
/** Can this client see the scene point (x, y)? The GM always; a player under the fog of war or out of vision does not. */
function hereVisible(x, y) {
  if ( game.user?.isGM || !canvas?.visibility?.tokenVision ) return true;
  try { return !!canvas.visibility.testVisibility({ x, y }, { tolerance: grid() * 0.5 }); } catch { return true; }
}
/** MAPSFXSEAT: a spot of the REFERENCE window free of its shared panel zones (sfx-seat refScreenSpot; the word's seed turns the order) */
const refScreenSpot = (bw, bh, key = "") => SEAT.refScreenSpot(bw, bh, Math.floor(C.h01(key) * 3));
/**
 * Play a word unlocated (EFFECTS1, owner's answers 2 and 4; engine request KINDS1-1 for a real "screen" placement): in screen space over
 * the map (under the bars), not riding, not pointing at anything. MAPSFXSEAT: laid out ONCE in the reference window (its size from the
 * reference height, its spot off the shared panel zones, fitted by its real box and reach: screenPlace), then drawn centred in this
 * seat's window and moved (or, only when its whole reach is bigger than this window, made smaller) by the seat rule - before, each seat
 * sized it by its own height and shrank it to fit around its own panels: the GM's thunder word was smaller than a player's.
 */
function playScreen(spec, fixed = null) {
  if ( !L ) return;
  const grp = grpOf(spec), step = stepFor(grp);
  let o = optsOf(spec, true);
  delete o.path; delete o.from; delete o.area;
  Object.assign(o, { space: "screen", layer: "hud", at: null, keepInView: false });
  const plan = planInfo(spec.text, o);
  if ( !engineSizeFor ) return;
  // (a ranked word: its rank's share of the reference height, at the group's size step - at a bigger step under the engine's ceiling for
  // its loudest word on the reference screen; another word: the engine's own size on the reference screen at the step)
  const o0 = { ...o };
  if ( Number.isFinite(spec.rank) ) o.size = SEAT.tableScreenSize(engineSizeFor, L.sizeModel, { ...o, size: EV.rankSize(spec.rank, SEAT.REF_VH, spec.shrink ?? 1) }, plan, step);
  else { const so = SZ.sizeOpts(o, step); o.size = SEAT.refSize(engineSizeFor, so, plan, { space: "screen" }).size; }
  o.fit = "screen"; delete o.scale;
  const ref = screenPlace(spec.text, o, fixed, spec.seed);
  if ( !ref ) return;
  o.size *= ref.k;
  const g0 = gen, go = () => {
    if ( g0 !== gen || !L || mode() === "off" || stepFor(grp) === 0 ) return;
    if ( lifeOver(spec) ) { stats.late++; return; }
    // (MAPSFXSEAT2, this seat: the reference window centred in its own; its size the one THIS window gives it at step 2 - as before the
    // table picture - then the step's share; laid out off its panels, its pins and the unlocated words still up here, scaled about its
    // centre and moved the least, smaller only to fit this window)
    uiBoxes();
    const sc = L.prefs?.scale ?? 1, W = innerWidth, H = innerHeight, off = SEAT.screenOffset(W, H), sv = seatView(1, sc);
    const caps = T.screenCaps(engineSizeFor, L.sizeModel, o0, plan, { rank: Number.isFinite(spec.rank) ? spec.rank : null, shrink: spec.shrink ?? 1, step: stepFor(grp), vw: sv.vw, vh: sv.vh, scale: sc });
    const box = { x0: ref.box.x0 + off.x, y0: ref.box.y0 + off.y, x1: ref.box.x1 + off.x, y1: ref.box.y1 + off.y }, now = sharedNow();
    screenUp = screenUp.filter((q) => q.life[1] > now);
    const life = [spec.ts ?? toShared(spec.t), (spec.ts ?? toShared(spec.t)) + lifeMs(spec)];
    const item = { key: "s", prio: 0, box, u: ref.cap, sub: null, sizes: caps?.sizes ?? [ref.cap * sc], min: caps?.min ?? ref.cap * sc, full: caps?.full ?? 0, small: caps?.small ?? 0, floor: caps?.floor ?? 0, nom: caps?.nom ?? null, step: caps?.step ?? null, life };
    // (MAPEDGE: this seat's panels are panels - its ink never on them, PANEL_OK -, the unlocated words still up are words up)
    const f = SEAT.seatLayout([item], { view: { x0: 0, y0: 0, x1: W, y1: H }, panels: uiCache.rects ?? [], up: screenUp.filter((q) => q.life[0] < life[1]).map((q) => ({ box: q.box, life: q.life })), pins: pinRects(), zoom: 1 }).get("s");
    const at = SEAT.layoutAt({ x: ref.x + off.x, y: ref.y + off.y }, f);
    const oo = { ...o, at, size: f.cap / ((plan?.sizeK ?? 1) * sc), startAt: spec.t, reduced: reducedMotion() };
    try {
      const h = L.play(spec.text, oo);
      if ( h ) { keepStorm(spec, h); stats.words++; stats.unlocated = (stats.unlocated ?? 0) + 1; screenUp.push({ box: f.box, life }); logCall(spec, { o: oo, fit: { ...f, k: oo.size / o.size }, box: f.box, table: { size: o.size, at: { x: ref.x, y: ref.y } }, space: "screen" }); }
    } catch ( err ) { console.warn(`${MODULE_ID} | sfx: a word did not play`, err); }
  };
  const wait = spec.t - performance.now();
  if ( wait > 4 ) later(`ws|${spec.seed}|${spec.t}`, wait, go); else go();
  lastPlaced.push({ text: spec.text, role: spec.role, voice: spec.voice, screen: { x: ref.x, y: ref.y }, k: +ref.k.toFixed(3), box: ref.box, clean: ref.hit <= 0 });
  trimPlaced();
}
/** THUNDERFIT + MAPSFXSEAT: where and how big an unlocated word stands in the REFERENCE window, by its REAL box and reach (the engine's
    own measure, L.measure): sfx-seat screenLayout. -> { x, y, k, cap, hit, box, reach } (reference-window CSS px) | null */
function screenPlace(text, o, fixed, key = "") {
  const md = measureOf(text, { ...o, at: { x: 0, y: 0 } }), hd = md ?? holdOf(text, o);
  if ( !hd ) return null;
  return SEAT.screenLayout({ hold: hd, reach: md?.reach ?? null, cap: (o.size ?? 0) * hd.sk, fixed, turn: Math.floor(C.h01(key) * 3), stageIn: o.in });
}

/** Is the shooter at scene point `from` (radius `fr`) visible to this client? A token there that this client cannot see: no. */
function shooterSeen(from, fr) {
  if ( game.user?.isGM ) return true;
  // (the NEAREST token there is the shooter: live, a visible token standing next to a hidden turret was taken for it - the first in the
  // list within reach - and the turret's launch word was drawn at the hidden turret)
  const G = grid(), d = (q) => Math.hypot(q.center.x - from[0], q.center.y - from[1]);
  const t = (canvas.tokens?.placeables ?? []).filter((q) => q.center && d(q) < (fr ?? G * 0.5) + G * 0.3).sort((a, b) => d(a) - d(b))[0];
  if ( t ) return !!t.visible && !t.document?.hidden;
  return hereVisible(from[0], from[1]);
}
/** A gun's REPORT shown unlocated (no source token, or a source this client cannot see): the engine's stream of its gun kind in
    screen space at a free spot of this client's screen, one syllable per round as it leaves (`walk` ms from `t0`, perf clock). */
function screenReport(walk, t0, kinds, key) {
  if ( mode() !== "all" || !walk?.length || stepFor("destruction") === 0 ) return;
  const go = () => {
    if ( !L ) return;
    const kind = C.kindOf("muzzle", known, null, kinds), rs = refScreenSpot(SEAT.REF_VW * 0.22, SEAT.REF_VH * 0.1, key), off = SEAT.screenOffset(innerWidth, innerHeight);
    const at = { x: rs.x + off.x, y: rs.y + off.y };
    try {
      L.stream({ kind, lang: lang(), space: "screen", layer: "hud", at: () => at, dir: -90, beats: C.streamBeats(walk), startAt: t0, magnitude: 0.6,
        seed: `${canvas.scene?.id ?? ""}|${key}`, loud: (i) => 0.7 + 0.3 * Math.sin(i * 1.7), reduced: reducedMotion(), ...streamStep("destruction", { space: "screen", magnitude: 0.6 }) });
      stats.unlocated = (stats.unlocated ?? 0) + 1;
    } catch ( err ) { console.warn(`${MODULE_ID} | sfx: a report did not play`, err); }
    lastPlaced.push({ text: kind, role: "main", voice: "muzzle", screen: at });
  };
  later(`rep|${key}`, t0 - performance.now() - 30, go);
}

/** Fire: the layer's strokes changed (or the scene opened): the events of what is new or changed. */
function onFire(first = false) {
  if ( !canvas?.scene ) return;
  scanFirings();
  const now = sharedNow(), all = Fire.allStrokes?.() ?? new Map(), seen = new Map();
  const on = mode() !== "off" && Fire.shownHere?.();
  const geo = Fire.geo(), P = Fire.params0(), G = grid();
  const burningList = [...all.values()].filter((s) => s.k === "fire" && FM.burningAt(s, now));
  const T = FM.timing(geo, P);
  // (MAPBURN2: `heard` - another fire caught in this stroke's area of the map within CATCH_QUIET before it (the table's strokes and
  // their shared catch moments: the same on every seat; of two that caught at one instant the first id speaks))
  const cell = (BURN.AREA_VH * SEAT.REF_VH) / SEAT.refZoom(G, 0), cellId = (s) => { const c = BURN.cellOf({ x: s.p?.[0] ?? 0, y: s.p?.[1] ?? 0 }, cell); return `${c.cx},${c.cy}`; };
  const lits = [...all.values()].filter((s) => s.k === "fire").map((s) => ({ id: s.id, t: Number(s.g ?? s.q ?? 0), lt: s.lt, c: cellId(s) }));
  const ctx = { grid: G, burning: (er) => burningList.some((f) => overlapsStroke(f, er)), late: 1500, newLate: first ? 0 : C.NEW_LATE,
    flared: (st) => { const c = cellId(st); return lits.some((o) => o.id !== st.id && o.c === c && Number.isFinite(o.lt) && (o.lt < st.lt ? st.lt - o.lt < C.CATCH_QUIET : o.lt === st.lt && o.id < st.id)); },
    heard: (st, lit) => { const c = cellId(st); return lits.some((o) => o.id !== st.id && o.c === c && (o.t < lit ? lit - o.t < C.CATCH_QUIET : o.t === lit && o.id < st.id)); },
    outMs: 1.6 * T.O / Math.max(0.2, P.speed ?? 1), passMs: (st) => { try { return DM.passMs(st, geo); } catch { return 1500; } } };
  for ( const st of all.values() ) {
    const prev = fireSeen.get(st.id) ?? null;
    seen.set(st.id, st);
    // a fire that went out (or was taken back): nothing it scheduled earlier may still letter it
    if ( prev && st.k === "fire" && st.o !== undefined && prev.o !== st.o ) cancelObj(st.id);
    if ( !on ) continue;
    // a scene that opens: the stroke counts as seen - only its moments still to come; later, what is new or changed
    const evs = first ? C.strokeEvents(st, null, now + 1, now + MAX_AHEAD, { ...ctx, late: 0, newLate: 0 }) : C.strokeEvents(st, prev, now, now + MAX_AHEAD, ctx);
    for ( const e of evs ) add({ ...e, t: toPerf(e.t) });
  }
  for ( const id of fireSeen.keys() ) if ( !seen.has(id) ) cancelObj(id);    // (removed: undone, cleared)
  fireSeen = seen;
  scheduleBurn(0);
}
function overlapsStroke(f, er) {
  const r = (f.r ?? 50) + (er.r ?? 50), p = f.p ?? [], ex = er.p?.[0], ey = er.p?.[1];
  for ( let i = 0; i + 1 < p.length; i += 2 ) if ( Math.hypot(p[i] - ex, p[i + 1] - ey) < r ) return true;
  return false;
}

/* ---------------------------------------------------------------- a burning fire's sound: its lines */

function scheduleBurn(ms) { clearTimeout(burnTimer); const g0 = gen; burnTimer = setTimeout(() => { burnTimer = 0; if ( g0 === gen ) reconcileBurn(); }, ms); }
/** Which fires burn and are shown here: each group is a voice of the fire lettering (MAPBURN2: it speaks in lines - sfx-burn LINE -, an
    area of the map at most one line a turn, the word beside its flames; before, every spot of every fire lettered a run without a break). */
function reconcileBurn() {
  const want = new Map();
  const on = mode() === "all" && Fire.shownHere?.() && canvas?.ready && stepFor("fire") > 0;
  if ( on && L?.play ) {
    const now = sharedNow(), G = grid();
    // (MAPSFXSEAT: the table's fires - burning since their shared catch moment + BURN_AFTER, on every seat alike; before, from when its
    // flames first showed HERE, so a busy seat started a fire's sound seconds later, with other spots and phrases)
    const fires = [...(Fire.allStrokes?.() ?? new Map()).values()].filter((s) => s.k === "fire" && FM.burningAt(s, now) && Number(s.g ?? s.q ?? 0) + BURN_AFTER <= now);
    const geo = Fire.geo(), P = Fire.params0();
    // (MAPRIDE: each fire's own clock - the shared instant its group began to burn; MAPBURN2: `group` its strokes - the flames a word keeps off)
    const plans = C.burnGroups(fires, G).map((g) => ({ ...C.burnPlan(g, { grid: G, catchMs: (st) => FM.catchMs(st, geo, P), levelNow: (s, t) => FM.levelNow(s, Number.isFinite(t) ? t : undefined) }),
      start: Math.min(...g.map((s) => Number(s.g ?? s.q ?? 0))) + BURN_AFTER, group: g }))
      .sort((a, b) => b.prio - a.prio);
    const spots = [];
    for ( const p of plans ) {
      // (MAPBURN2: every fire of the table is a voice, on every seat alike - the amount of lettering is bounded by the areas (sfx-burn
      // areasOf / lineOf), not by a count of "live" fires any more: the quiet mode for the fires past a seat's cap is gone with the runs)
      // (a smaller fire whose words would sit on a bigger one's: heard in the bigger one's, not lettered on top of them; the table's
      // size - this seat's own lettering size setting moves its words off its panels only)
      // (MAPBURN: at the size the score's room has now - its top rung's share, sfx-burn topScale - so a smoulder's spots crowd by its own block)
      const all = p.points.map((_, i) => p.at(i, now)), em = burnSize(p, true) * 1.25 * BURN.topScale(BURN.heatOf(p.level(now)).top);
      // (THUNDERFIT: the spots of ONE fire crowd each other too when its words are big for the way its path runs on this screen - a far
      // zoom, a bigger size step; the first spot stays, a spot on an earlier one is heard in it)
      const idx = C.burnSpots(all, em), pts = idx.map((i) => all[i]);
      if ( C.burnCrowded(pts, spots, em) ) continue;
      spots.push(...pts.map((q) => ({ x: q.x, y: q.y, em })));
      want.set(p.key, { plan: p, live: true, idx });
    }
  }
  // (MAPRIDE: this seat's room for every voice, in the table's order: a word never stands in a room laid out before it; a spot with no
  // clean room on this seat is not lettered here)
  const rooms = burnRooms(want);
  // (a fire gone out, removed or regrouped: the word it has up - one word, a second and a half at most - plays its own exit; no run to stop)
  for ( const k of [...burns.keys()] ) if ( !want.has(k) ) burns.delete(k);
  for ( const [k, w] of want ) {
    const r = rooms.get(k) ?? [], b = burns.get(k) ?? { subs: [] };
    burns.set(k, Object.assign(b, { plan: w.plan, live: true, idx: w.idx.filter((i) => r[i]?.ok !== false), all: w.idx, off: r }));
  }
  burnOrder = [...want.keys()];
  stats.burns = burns.size;
  if ( burns.size ) speakDue();
  // (once a second, and just before each slot's instant: a line is handed to the engine LINE.lead ahead, to begin on the shared instant)
  if ( burns.size || (stepFor("fire") > 0 && [...(Fire.allStrokes?.() ?? new Map()).values()].some((s) => s.k === "fire")) ) {
    const S = BURN.LINE.slot, toSlot = S - (((sharedNow() + BURN.LINE.lead) % S) + S) % S;
    scheduleBurn(Math.max(40, Math.min(1000, toSlot)));
  }
}
/** Where each spot's words must move to stay off this client's interface panels (their phrases hover around the spot, in two seats
    one above the other, a little to either side: a box of about nine of their letters wide (an echo trails beside it) and three and a half high, mostly above
    it). Measured once a second with the burn. */
function burnRooms(want) {
  const out = new Map();
  try {
    // (off the panels, and off the event words still up: a debris word that landed where the fire then catches)
    // (THUNDERFIT: and off the map's pins - live, a burning fire's phrases stood on the scene's skull pin)
    // (MAPSFXSEAT: the seat rule's shift - off THIS seat's panels and pins; and off the table's words up, the same words on every seat)
    // (MAPRIDE: the run's real block - sfx-seat RUN: it is ~7.8 caps tall (two seats of phrases, the lower below the source), the old box was 4 caps short and the run took its own
    // height over the macro bar -, pins and tokens never under it, the runs laid out before it a panel to it; the engine keeps the run
    // inside that block - its `room` - and its phrases to the block's width - `maxWidth`)
    // (MAPEDGE: the view inside the scene's rectangle - a run is never lettered on the padding round the map)
    const now = sharedNow(), v0 = mapView(), z = canvas.stage?.scale?.x || 1, m = SEAT.SEAT_EDGE / z;
    const v = { x0: v0.x0 + m, y0: v0.y0 + m, x1: v0.x1 - m, y1: v0.y1 - m };
    // (panels are hard for a run, not a 6 % share as for a word: 6 % of a run's tall block is a whole phrase hidden at its edge - live, the
    // player's FOOOOOMF ran under the challenges panel)
    // (and off the words THIS seat drew where they stand here - the seat layout moves them from the table's place: live the player's
    // KA-BOOOOM!! stood where a run then lettered; a run that started first moves off within its next second)
    const soft = [...ledger.boxes(now, now + 1000), ...[...alive].map((r) => r.box).filter(Boolean)], taken = [];
    // (MAPCOST: this seat's panels, pins and tokens are read only once a run has a spot in this view - the panel walk visits up to UI_VISIT
    // page elements, and it ran every second for a fire nobody on this seat was looking at, and with the lettering off)
    let hard = null;
    const maxShift = Math.max(v.x1 - v.x0, v.y1 - v.y0) * 0.45;
    for ( const [key, w] of want ) {
      const p = w.plan, sc = L?.prefs?.scale ?? 1, arr = [], st = stepFor("fire");
      // (MAPBURN: the score's room - its roar's size x the share its heat reaches now: a smoulder keeps a smaller block clear than a blaze,
      // and the block grows with the fire, the engine reads `room` every frame - at THIS seat's size: the table's inside the seat's own
      // bounds - sfx-burn seatSize: far out the smallest phrase still legible (ADVM r2 item 8, J: unreadable chips at zoom 0.143), close in
      // the roar no taller than ROAR_VH of this window; the quiet mode keeps the engine's own clamp)
      const ts = w.live ? BURN.topScale(BURN.heatOf(p.level(now)).top) : 1, vh = globalThis.innerHeight || 900;
      const seatK = (kk) => (w.live ? BURN.seatSize(kk, { zoom: z, vh, capK: capK(), floorPx: SZ.floorPx(vh, 1, L.sizeModel) }) : kk);
      // (MAPBURN2: a line is one word: its block is BLOCK of a run's - `k` the block's unit, `ks` the size of the fire's biggest word here)
      const k0 = burnSize(p, w.live) * sc * BURN.BLOCK, ks = (seatK(k0 / BURN.BLOCK) * ts), k = ks * BURN.BLOCK;
      // (MAPBURN2: and it stands at its fire's RIM, on the side its sparks go - downwind, sfx-direct plumeDeg; still air: up -, as near as
      // it can with at most COVER.fire of the fire under it - sfx-burn rimSpot: before, on the spot, on the flames. The word's box at
      // this seat's size, from the table's spot: `at0`)
      rimAt(p, ks);
      // (smaller on this seat where the table's size has no clean room - down to the legibility floor of its window, never under it -,
      // laid out from the lower steps up so a higher step never letters a run smaller: sfx-seat burnRoom; question MAPRIDE-3)
      const kMin = Math.min(k, (w.live ? BURN.minSize({ zoom: z, capK: capK(), floorPx: SZ.floorPx(vh, 1, L.sizeModel) }) * ts : SZ.floorPx(vh, 1, L.sizeModel) / z) * BURN.BLOCK), below = [1, 2, 3].filter((s) => s < st).map((s) => seatK(burnSize(p, w.live, s) * sc) * ts * BURN.BLOCK);
      // (a spot off this screen stays where it is: its words are not pulled into view, and it takes no room here)
      const on = w.idx.filter((i) => { const q = p.at(i, now); return q.x > v0.x0 && q.x < v0.x1 && q.y > v0.y0 && q.y < v0.y1; });
      // (MAPSAME: one whose run would still reach into this view, cut at its edge, is not lettered here - sfx-seat offSpot)
      const motion = L?.motionMode?.() === "stepped" ? "stepped" : "smooth";
      // (MAPEDGE: its run kept to its own block - the block offSpot judged - so a run "out" of this view stays out: with no room the engine let
      // its phrases spread past the block and a fire burning just above the GM's view lettered into it, cut by the top edge - ADVM r2 item 6, A)
      for ( const i of w.idx ) if ( !on.includes(i) ) { const q = p.at(i, now); arr[i] = { dx: 0, dy: 0, box: null, room: SEAT.runBox(q, k), ok: SEAT.offSpot(q, k, v0, motion) === "out", off: true }; }
      if ( on.length ) hard ??= [...uiBoxes(), ...pinBoxes(v0), ...tokenBoxes(v0)];
      const r = SEAT.burnRoom(on.map((i) => p.at(i, now)), { k, kMin, below, v, hard: hard ?? [], soft, taken, maxShift, motion });
      // (`f`: this seat's size for the run as a share of the table's - over 1 far out)
      on.forEach((i, j) => { arr[i] = { ...r[j], f: r[j].k / (k0 * ts) }; if ( r[j].ok ) taken.push(r[j].box); });
      out.set(key, arr);
    }
  } catch ( err ) { console.warn(`${MODULE_ID} | sfx: a fire's room`, err); }
  return out;
}
/** MAPBURN: the cap height of the engine's lettering per unit of `size` in the table's face (League Gothic 1.27, another face its own):
    the seat bounds of a scored run are heights on this screen */
let capMemo = null;
function capK() {
  let face = ""; try { face = String(L?.invFace?.() ?? ""); } catch {}
  if ( capMemo?.face === face ) return capMemo.k;
  let k = 1.27;
  try { const z = L.sizeOf("FWOOM", { kind: C.kindOf("fire", known), space: "world", size: 100, fit: "world" }); if ( z?.sizeK > 0 ) k = z.sizeK; } catch {}
  capMemo = { face, k };
  return k;
}
/** MAPBURN2: a fire's spots moved to its rim for a word of size `ks` (scene px): `p.at` gives the word's place from here on, `p.at0`
    the table's spot (the areas sort by it). Worked out again only when the fire, the spot or the size moved. */
const rimMemo = new Map();
function rimAt(p, ks) {
  if ( p.at0 ) return;
  const at0 = (p.at0 = p.at), sig = (p.group ?? []).map((s) => `${s.id}:${s.p?.length ?? 0}:${Math.round(s.r ?? 0)}`).join(), G = grid();
  const hw = BURN.WORD_BOX.hw * ks, hh = BURN.WORD_BOX.hh * ks;
  let shape = null;
  p.at = (i, now) => {
    const q = at0(i, now), key = `${p.key}|${i}`, tag = `${sig}|${Math.round(q.x / (G / 4))},${Math.round(q.y / (G / 4))}|${Math.round(ks)}`;
    const m = rimMemo.get(key);
    if ( m?.tag === tag ) return { x: m.x, y: m.y };
    shape ??= BURN.fireShape(p.group ?? []);
    const r = BURN.rimSpot(q, shape, { hw, hh, dir: DIR.plumeDeg(DIR.windOf(p.st)) });
    rimMemo.set(key, { tag, x: r.x, y: r.y }); if ( rimMemo.size > 64 ) rimMemo.delete(rimMemo.keys().next().value);
    return { x: r.x, y: r.y };
  };
}
/** The cap height (scene px) of a burning fire's biggest word - its roar: a share (sfx-burn ROAR_REF) of the REFERENCE view's height at
    the reference zoom (MAPSFXSEAT: the same size on every seat), at the fire group's size step. MAPBURN2: clearly smaller than before
    (3.8 % against 6.4 %): the flames are the picture, the word a caption beside them. */
function burnSize(p, live, step = stepFor("fire")) {
  // (MAPRIDE: the level at the run's shared start, not this seat's now: the same size on every seat, one joining late too)
  const zoom = SEAT.refZoom(grid(), 0), lv = p.level(Number.isFinite(p.start) ? p.start : sharedNow());
  // (MAPBURN: a scored run's size is its ROAR's - the biggest phrase, the others are shares of it, sfx-burn RUNGS - the same for every
  // fire: how big a fire letters is how high its heat lets it climb, not another size per level; the quiet mode as before)
  const px = SEAT.REF_VH * (live ? BURN.ROAR_REF : 0.03); void lv;
  // (SFXSIZE: at the fire group's size step; the phrase spacing and the panel shifts use this size too)
  return SZ.sizeAt(Math.max(4, px / zoom), step);
}
/** MAPBURN2: the lines due now. The table's voices (every lettered spot of every burning fire, the biggest fire first) by area of the
    map - at their place and heat at the slot's own shared instant, so every seat sorts them alike -; an area whose colour the slot is
    speaks its line (sfx-burn lineOf), once: a seat that comes to it past LINE.join of the word's standing time leaves it out. */
function speakDue() {
  try {
    // (MAPRIDE: a line joins the shared clock only once this seat's clock has settled - live a player just after a reload was ~280 ms
    // off with the clock "ready" (ENGVIEW-1); its lines wait a second or two for it, at most CLOCK_WAIT after the page loaded)
    if ( (L?.clock?.error?.() ?? 0) > CLOCK_OK && performance.now() < CLOCK_WAIT ) return;
    const now = sharedNow(), S = BURN.LINE.slot, cell = (BURN.AREA_VH * SEAT.REF_VH) / SEAT.refZoom(grid(), 0);
    for ( let n = Math.floor((now - S) / S); n * S <= now + BURN.LINE.lead + 60; n++ ) {
      const t0 = n * S, sl = BURN.slotAt(t0), voices = [];
      for ( const key of burnOrder ) {
        // (a fire that was not burning yet at the slot's instant has no voice in it: the same on every seat, whenever it looks)
        const b = burns.get(key); if ( !b || b.plan.start > t0 ) continue;
        const lv = b.plan.level(t0);
        for ( const i of b.all ) { const q = (b.plan.at0 ?? b.plan.at)(i, t0); voices.push({ key, i, x: q.x, y: q.y, level: lv }); }
      }
      for ( const a of BURN.areasOf(voices, cell).values() ) {
        if ( a.colour !== sl.colour ) continue;
        const id = `${a.id}|${sl.turn}`; if ( spoken.has(id) ) continue;
        const line = BURN.lineOf(a, sl.turn); if ( !line ) continue;
        spoken.set(id, t0);
        letterLine(line, now);
      }
    }
    for ( const [id, t] of spoken ) if ( t < now - 3 * BURN.TURN_MS ) spoken.delete(id);
  } catch ( err ) { console.warn(`${MODULE_ID} | sfx: a fire's line`, err); }
}
/** One line of a fire on this seat: the word of the area's score (sfx-burn burnScore: the fire ladder climbed line by line, from shared
    data - the fire's id, the area's line number, the fire's heat at the line's instant), at this seat's size and place for it, begun on
    the line's shared instant. */
function letterLine(line, now) {
  const v = line.voice, i = v.i, b = burns.get(v.key), p = b?.plan;
  const no = BURN.lineNo(line, p?.start), rec = { area: line.area, turn: line.turn, t: line.t0, key: v.key, i, n: no };
  const note = (r) => { burnLog.push({ ...rec, ...r }); if ( burnLog.length > 40 ) burnLog.shift(); };
  try {
    if ( !p ) return;
    const o = b.off?.[i];
    // (a spot with no clean room on this seat, or off this view: not lettered here - the table's line is the same, this seat leaves it out)
    if ( !b.idx.includes(i) ) return note({ out: "room" });
    if ( o?.off ) return note({ out: "view" });
    const seed = `${canvas.scene?.id ?? ""}|burn|${p.seedId}`, red = reducedMotion(), kind = C.kindOf("fire", known);
    // (which voice of the score a spot is: its place among the table's spots of this fire - the second and third start further on in
    // the arc and stay a rung under the first, which owns the roar)
    const score = BURN.burnScore({ seed: `${seed}|${i}`, heat: (t) => p.level(t), word: (q) => { const w = L.word(kind, { ...q, lang: lang() }); return { text: w.text, mood: w.mood }; },
      colors: p.colors ?? null, reduced: red, spot: Math.max(0, b.all.indexOf(i)) });
    const ph = score(no, line.t0);
    if ( !ph ) return note({ out: "word" });
    if ( now >= line.t0 + ph.ms * BURN.LINE.join ) return note({ out: "late", text: ph.text });
    // (this seat's size for the fire's words: the table's, or smaller where its room was short - burnRooms; a word's own size is its
    // rung's share of it, floored at this window's legibility floor - far out the ladder flattens, the words and instants stay the table's)
    const f = o?.f ?? 1, size = burnSize(p, true) * f, k = size * (L?.prefs?.scale ?? 1);
    const fl = BURN.floorScale(k, { zoom: canvas.stage?.scale?.x || 1, capK: capK(), floorPx: SZ.floorPx(globalThis.innerHeight || 900, 1, L.sizeModel) });
    ph.scale = Math.max(ph.scale, Math.min(fl, BURN.fitScale(ph.text.length, ph.top)));
    // (its place: the fire's rim - burnRooms -, moved off this seat's panels, pins, tokens and the words up)
    const q = p.at(i, now), at = o ? { x: q.x + o.dx, y: q.y + o.dy } : q;
    // (MAPBURN: no glow where the word stands over the scene's lighting - there it is not darkened, and the glow was a soft orange box
    // behind the letters that outlived them, ADVM r2 item 8. One word: no echo, no shed sparks, no tail - EFFECTS1)
    const call = BURN.lineCall(ph, { kind, seed: `${seed}|${i}|${no}`, size, at, startAt: toPerf(line.t0), reduced: red,
      glow: BURN.glowFor(layerOpts().layer, "auto"), extra: { lang: lang(), ...layerOpts() } });
    const h = L.play(call.text, call.opts);
    if ( h ) { b.subs.push(h); Promise.resolve(h.finished).finally(() => { const j = b.subs.indexOf(h); if ( j >= 0 ) b.subs.splice(j, 1); }); }
    note({ text: ph.text, rung: ph.rung, scale: +ph.scale.toFixed(3), size: +size.toFixed(1), x: Math.round(at.x), y: Math.round(at.y) });
  } catch ( err ) { console.warn(`${MODULE_ID} | sfx: a fire's line did not start`, err); }
}

/* ---------------------------------------------------------------- this client's screen */

/** MAPEDGE: this seat's view of the MAP - its view inside the scene's rectangle (sfx-seat sceneView): world words and runs stand there,
    never on the padding round the map */
function mapView() {
  try { return SEAT.sceneView(view(), canvas.dimensions?.sceneRect); } catch { return view(); }
}
function view() {
  const v = canvas.app.renderer.screen, st = canvas.stage;
  const tl = st.toLocal({ x: 0, y: 0 }), br = st.toLocal({ x: v.width, y: v.height });
  return { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y };
}
function tokenBoxes(v) {
  const out = [];
  for ( const t of canvas.tokens?.placeables ?? [] ) {
    if ( !t.visible || t.document?.hidden && !game.user.isGM ) continue;
    const b = t.bounds; if ( !b ) continue;
    if ( b.right < v.x0 || b.left > v.x1 || b.bottom < v.y0 || b.top > v.y1 ) continue;
    out.push({ x0: b.left, y0: b.top, x1: b.right, y1: b.bottom });
  }
  return out;
}
/** THUNDERFIT: the map's note pins this seat sees (scene px): the pin drawn over a note (pin.mjs: its tip at the note, its head about two
    thirds of its height above) or the note's own icon. Live at step 3 a blast's main word stood over the pins; a pin counts like a token
    for the placement. A pin this seat does not see (a hidden note, the user's pin filter) is no obstacle here. */
function pinBoxes(v) {
  const out = [];
  for ( const n of canvas.notes?.placeables ?? [] ) {
    try {
      if ( !n.visible || n.destroyed ) continue;
      const pin = n._mmPin, x = n.document?.x ?? n.x, y = n.document?.y ?? n.y;
      let b;
      if ( pin && !pin.destroyed ) { if ( (pin.pres ?? 1) < 0.5 ) continue; const S = pin.S || 40; b = { x0: x - 0.45 * S, y0: y - 1.05 * S, x1: x + 0.45 * S, y1: y + 0.08 * S }; }
      else { const r = n.bounds; if ( !r ) continue; b = { x0: r.left ?? r.x, y0: r.top ?? r.y, x1: r.right ?? r.x + r.width, y1: r.bottom ?? r.y + r.height }; }
      if ( b.x1 < v.x0 || b.x0 > v.x1 || b.y1 < v.y0 || b.y0 > v.y1 ) continue;
      out.push(b);
    } catch { /* a note being redrawn */ }
  }
  return out;
}
/** THUNDERFIT: this seat's visible pins on the screen (client px), for the unlocated words */
function pinRects() {
  try {
    const st = canvas.stage, rc = canvas.app.view.getBoundingClientRect();
    return pinBoxes(view()).map((b) => { const a = st.toGlobal({ x: b.x0, y: b.y0 }), c = st.toGlobal({ x: b.x1, y: b.y1 }); return { x0: rc.left + a.x, y0: rc.top + a.y, x1: rc.left + c.x, y1: rc.top + c.y }; });
  } catch { return []; }
}
/** the tokens every seat counts (sfx-seat sharedTokenBox: a document nobody hides, its box from the document), near view `v` */
function sharedTokens(v) {
  const G = grid(), out = [];
  for ( const d of canvas.scene?.tokens ?? [] ) {
    const b = SEAT.sharedTokenBox(d, G); if ( !b ) continue;
    if ( v && (b.x1 < v.x0 || b.x0 > v.x1 || b.y1 < v.y0 || b.y0 > v.y1) ) continue;
    out.push(b);
  }
  return out;
}
/** the note pins every seat counts (sfx-seat sharedPin: a note every player may see; its pin's box from the scene's pin size), near `v` */
function sharedPins(v) {
  const out = [], players = (game.users?.contents ?? [...(game.users ?? [])]).filter((u) => !u.isGM);
  for ( const n of canvas.notes?.placeables ?? [] ) {
    try {
      const d = n.document; if ( !d ) continue;
      if ( !SEAT.sharedPin(players, (u) => { const e = d.page ?? d.entry; return e ? e.testUserPermission(u, "LIMITED") : true; }) ) continue;
      const S = n._mmPin?.S || (Number(d.iconSize) || 40) * 1.3, x = d.x, y = d.y;
      const b = { x0: x - 0.45 * S, y0: y - 1.05 * S, x1: x + 0.45 * S, y1: y + 0.08 * S };
      if ( v && (b.x1 < v.x0 || b.x0 > v.x1 || b.y1 < v.y0 || b.y0 > v.y1) ) continue;
      out.push(b);
    } catch { /* a note being redrawn */ }
  }
  return out;
}
/** The interface panels over the canvas on this client (Foundry's and any module's), in scene px. */
function uiBoxes(force = false) {
  const now = performance.now();
  if ( !force && now - uiCache.t < UI_MS ) return uiCache.boxes;
  const t0 = now, board = canvas.app?.view ?? document.getElementById("board");
  const rect = board?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
  let rects = [];
  try {
    // (MAPEDGE: up to UI_VISIT elements - the walk stopped at 900 of a v14 page's ~8 000 before it reached plus-ultra's party panel
    // (#invincible-party, fixed, bottom-left): the GM's thunder lead-in and the player's fire-out word stood on it; ~5 ms per walk)
    rects = C.uiRects([...document.body.children], { style: (el) => getComputedStyle(el), vw: innerWidth, vh: innerHeight, max: UI_VISIT,
      skip: (el) => el === board || el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "LINK" || el.classList?.contains("moinen-letters-layer") || el.classList?.contains("moinen-letter") || el.id === "tooltip" || el.classList?.contains("tooltip") || el.id === "pause" });
  } catch ( err ) { rects = []; }
  const st = canvas.stage;
  const boxes = C.toSceneBoxes(rects, (p) => st.toLocal({ x: p.x - rect.left, y: p.y - rect.top }));
  uiCache = { t: now, rects, boxes };
  stats.uiMs += performance.now() - t0;
  return boxes;
}

/* ---------------------------------------------------------------- words out */

function flush() {
  gatherTimer = 0; warmGen++;
  const now = performance.now();
  const due = pending.filter((e) => C.dueAt(e) <= now + 20), rest = pending.filter((e) => C.dueAt(e) > now + 20);
  pending = rest;
  if ( rest.length ) gatherTimer = setTimeout(flush, Math.max(10, Math.min(...rest.map((e) => C.dueAt(e))) - now));
  if ( !due.length || mode() === "off" || !canvas?.ready ) return;
  if ( !L ) { pending.push(...due); engine(); return; }      // (engine() flushes again once it is loaded, this scene only)
  const t0 = performance.now();
  // MAPSFXSEAT: the events of a moment in the chunks a seat on time gathers them in (its first event's moment + the gathering): a seat
  // whose events came late (busy applying the destruction) used to gather two moments into one cluster - other words than its neighbour
  for ( const m of T.moments(due) ) flushMoment(m);
  stats.ms += performance.now() - t0;
}
/** The words of one moment: planned on the TABLE (shared: the reference view, the shared obstacles, the table's words up), then shown on
    this seat by its own needs (lettering "big only", its performance mode's room) and the seat rule (play). */
function flushMoment(due) {
  const now = performance.now();
  const caps = C.CAPS[perfMode()] ?? C.CAPS.high, big = mode() === "big";
  recent = recent.filter((r) => now - r.t < Math.max(C.ECHO_MS, C.OUT_GAP_MS));
  for ( const { g, placed, echo, specs } of T.planMoment(due, tdeps(), recent) ) {
    stats.clusters++;
    if ( echo ) { stats.echoes = (stats.echoes ?? 0) + 1; continue; }
    stats.dropped += specs - placed.length;
    // this seat's own needs: "big only" keeps the main words of big sounds (planCluster's own rule), a lower performance mode fewer
    // satellites and fewer words up
    // (GMALLMAPS: "big only" is the TABLE's now - sfx-prefs shareOf, the same rule; the performance caps stay this seat's)
    const mine = PF.shareOf(placed, { big, caps, alive: alive.size, capWords: C.capWords });
    for ( const w of placed ) if ( !mine.includes(w) ) seatSkip(w, big ? "big" : "perf");
    // (the moment's located words are one picture: a seat lays them out together - sfx-seat seatLayout; the table's whole group, not
    // this seat's filtered share, so every seat applies its rule to the same picture)
    const grp = { words: placed.filter((w) => !w.stream && Number.isFinite(w.x) && Number.isFinite(w.y)) };
    for ( const w of grp.words ) w.group = grp;
    for ( const w of mine ) { play(w); lastPlaced.push({ text: w.text ?? w.kind, role: w.role, voice: w.voice, box: w.box, ...(w.fitK !== undefined ? { fitK: w.fitK } : {}), pen: w.pen && { ui: +w.pen.pui.toFixed(3), tok: +w.pen.tok.toFixed(3), pin: +(w.pen.pin ?? 0).toFixed(3), wrd: +w.pen.wrd.toFixed(3), off: +w.pen.off.toFixed(3), sub: +w.pen.sub.toFixed(3) } }); }
    trimPlaced();
  }
}
/** MAPSFXSEAT: what the table's planning (sfx-table) may know: only what every seat shares (the engine, the running copy's size model,
    the scene, the world's word set, the table's settings, the ledger, the shared obstacles, the shared clock) - nothing of this seat's view */
function tdeps() {
  return { L, sizeFor: engineSizeFor, grid: grid(), sceneId: canvas.scene?.id ?? "", lang: lang(), known, ledger, toPerf, toShared, layer: layerOpts(),
    step: stepFor, memo: holdMemo, tokens: sharedTokens, pins: sharedPins, warn: (m, err) => console.warn(`${MODULE_ID} | sfx: ${m}`, err) };
}
/** The options a word plays with: its TABLE options (sfx-table optsOf; `raw`: before its step and table size) */
const optsOf = (w, raw = false) => T.optsOf(w, tdeps(), raw);
const planInfo = (text, o) => T.planInfo(text, o, tdeps());
const holdOf = (text, o) => T.holdOf(text, o, tdeps());
const measureOf = (text, o) => T.measureOf(text, o, tdeps());
const { lifeMs, lifeBox, moveBox, unionBox, scaleBox } = T;
/** is a word's whole life on the table over (a seat that got it late joins it mid-life, at the same point as every other seat; only a
    word whose life is over is not drawn) */
const lifeOver = (w) => performance.now() > w.t + lifeMs(w) - 250;

/**
 * MAPSFXSEAT2, THE SEAT RULE: how THIS seat draws a word of the table picture. Its text, seed, instant, and where it stands against the
 * thing it letters are the table's; how big is this seat's - the size its own window and zoom give the word at step 2 (the engine's own
 * size model with the table's options and words up), then the step's share - so no seat draws a weaker word than it drew before the table
 * picture and step 3 > 2 > 1 as drawn here. The words of a page / moment are laid out together (sfx-seat seatLayout): each scaled about its
 * point nearest the thing, kept there when clean (whole in the view, off this seat's panels, the pins, the shared tokens, the words up with
 * it), else moved the least - on its own side first, farther away but clean. This seat's own size setting (the engine's) is in its size,
 * its reduced motion changes how it moves. -> { o (the play options), fit, box (this seat's box), table } (o null: off).
 */
function seatCall(w) {
  const o = optsOf(w), at = o.at ?? { x: w.x, y: w.y };
  const vw = mapView(), zoom = canvas.stage?.scale?.x || 1, sc = L.prefs?.scale ?? 1;
  w.group ??= { words: [w] };
  const lay = groupLayout(w.group, vw, zoom, sc), f = lay?.get(w.key ?? `${w.seed}|${w.role}`);
  if ( !f ) return { o: { ...o, startAt: w.t, reduced: reducedMotion() }, fit: { rule: "ok", rules: [], k: 1 }, box: w.box, table: { size: o.size, at } };
  if ( f.rule === "off" || f.rule === "noroom" ) return { o: null, fit: f, box: f.box };
  const sh = (q) => SEAT.layoutAt(q, f);
  const oo = { ...o, at: sh(at), startAt: w.t, reduced: reducedMotion() };
  // (the size this seat draws: its cap over the table's, this seat's own size setting counted once - the engine applies it itself)
  if ( Number.isFinite(o.size) && w.size > 0 ) oo.size = (o.size * f.cap) / (w.size * sc);
  if ( o.path?.points && f.way ) {
    // (MAPRIDE: a rider rides the way THIS seat laid out - sfx-seat rideLayout: the table's, or turned / shortened / moved to stand clean)
    oo.path = { ...o.path, points: f.way.map((q) => ({ x: q.x, y: q.y })) }; oo.at = { x: f.way[0].x, y: f.way[0].y };
  } else if ( o.path?.points && !f.rules.includes("ride") ) oo.path = { ...o.path, points: o.path.points.map(sh) };
  else if ( o.path?.from ) oo.path = { ...o.path, from: sh(o.path.from), to: sh(o.path.to) };
  // (MAPEDGE: the side its sound comes from - the engine turns it into a direction from the word, which its motion and growth follow -
  // mapped with the word, so the word keeps the table's direction wherever this seat moved it: left at the table's point, a word pulled
  // thousands of px into this view took another direction than on the table and than its measure - live 2026-11-15 detonate)
  if ( o.from && Number.isFinite(o.from.x) && Number.isFinite(o.from.y) ) oo.from = sh(o.from);
  // (MAPEDGE: a word this seat laid out is not shoved by a later blast's `push` - the engine's shove is in absolute scene px from the
  // pusher's size here and turns by its force over the pushed word's size here, so each seat shoved and turned it differently and off the
  // place its layout checked clean: live 2026-11-15 detonate, the player's KA-KRROOOOMM!! pushed 250 px down-right and turned 29 deg, off
  // the window, the GM's 8 deg - question MAPEDGE-5, engine request MAPEDGE-E2)
  oo.pushable = false;
  // (reduced motion on this seat: a drifting or travelling word stands where the table's starts - as before, now as this seat's need)
  if ( oo.reduced && oo.path ) delete oo.path;
  // MAPDIRECT: a word with a way is KNOCKED along it after its contact (sfx-direct): a moving place on the word's own start clock - the
  // table's instant, in cap heights as this seat draws it, so every seat shows one pose at one instant; this seat only shortens it where
  // its view, its panels, the pins, the words up or the thing it letters are in the way. Reduced motion: none.
  let knock = null;
  if ( T.knocked(w) && !oo.reduced && !oo.path && f.box && f.cap > 0 && Number.isFinite(oo.at?.x) ) {
    const K = T.knockOf(w), ui = uiBoxes();
    // (the tokens are no block: a word in a fight stands among them - the seat layout weighs them - and half a cap of slide covers no
    // more of one than a neighbouring place would; live 2026-11-16: with them a blast's word had no room on either seat)
    const edge = [...ui, ...sharedPins(vw), ...pinBoxes(vw)];
    const blocks = [...edge, ...[...alive].filter((r) => r.box).map((r) => r.box)];
    const fit = DIR.knockFit(f.box, f.cap, w.way, K, { view: vw, blocks, edge, wall: w.subject ?? null });
    const base = oo.at, cap = f.cap;
    knock = { K, fit, way: w.way, h: null };
    const at = () => {
      const h = knock.h, c = h && Number.isFinite(h.contactAt) ? h.contactAt - w.t : KNOCK_CONTACT;
      const he = h && Number.isFinite(h.entMs) && Number.isFinite(h.holdMs) ? (h.exitAt ?? h.entMs + h.holdMs) : c + (w.holdMs || 900);
      const q = DIR.knockAt(w.way, performance.now() - w.t, { K, contact: c, holdEnd: he, fit });
      return { x: base.x + q.x * cap, y: base.y + q.y * cap };
    };
    // (a place that is a function still reads as a point - the seat log, the harnesses: moinen-letters lesson DIRECT 2)
    at.x = base.x; at.y = base.y;
    oo.at = at;
  }
  return { o: oo, knock, fit: { ...f, k: oo.size && o.size ? oo.size / o.size : 1 }, box: f.box, table: { size: o.size, at } };
}
/** this seat's window for the size model (the engine's own: the usable width leaves an open sidebar out) */
function seatView(zoom, sc) {
  const sb = document.getElementById("sidebar")?.getBoundingClientRect?.();
  return { vw: Math.max(320, innerWidth - (sb && sb.left > innerWidth * 0.5 ? sb.width : 0)), vh: innerHeight, zoom, scale: sc };
}
/** the seat layout of a group (a page's or a moment's located words; a word on its own is a group of one), once per view of this seat */
const layKey = (vw, ui, sc) => (vw ? `${Math.round(vw.x0)}|${Math.round(vw.y0)}|${Math.round(vw.x1)}|${Math.round(vw.y1)}|${ui.length}|${sc}|${innerWidth}x${innerHeight}` : "");
function groupLayout(grp, vw, zoom, sc) {
  const ui = uiBoxes();
  const key = layKey(vw, ui, sc);
  // (MAPPLAN: a page's words are laid out one by one, in the layout's own order, each when it is first asked for or in a slice before -
  // from the one reading of this seat's view and obstacles its layout started with: the same places as the whole page laid out then)
  if ( grp.page ) return plans.layout(grp, { key, full: () => laySnap(grp, vw, zoom, sc, ui) });
  if ( grp.seat && grp.seatKey === key ) return grp.seat;
  grp.seatKey = key;
  const d = tdeps(), items = T.seatItems(grp.words, d, seatView(zoom, sc));
  const pins = [...sharedPins(vw), ...pinBoxes(vw)];
  // (MAPRIDE: its cost on this seat - api.sfx.status().stats seatMs / seatN / seatMax - for live frame-time checks)
  // (MAPEDGE: the words this seat drew for OTHER moments and still has up are words up with this picture: sfx-seat seatLayout `up`)
  const up = [...alive].filter((r) => r.box && r.grp !== grp).map((r) => ({ box: r.box, life: r.life ?? null }));
  const t0 = performance.now(), r = SEAT.seatLayout(items, { view: vw, panels: ui, pins, tokens: sharedTokens(vw), zoom, up }), ms = performance.now() - t0;
  stats.seatMs = (stats.seatMs ?? 0) + ms; stats.seatN = (stats.seatN ?? 0) + 1; stats.seatMax = Math.max(stats.seatMax ?? 0, ms);
  return (grp.seat = r);
}
/** MAPPLAN: this seat read ONCE for a page group's layout (what the whole layout read: its view, panels, pins, tokens, the words up) */
function laySnap(grp, vw, zoom, sc, ui = uiBoxes()) {
  const pins = [...sharedPins(vw), ...pinBoxes(vw)];
  const up = [...alive].filter((r) => r.box && r.grp !== grp).map((r) => ({ box: r.box, life: r.life ?? null }));
  return { key: layKey(vw, ui, sc), ctx: { view: vw, panels: ui, pins, tokens: sharedTokens(vw), zoom, up }, d: { ...tdeps(), ledger: tableLedger }, seat: seatView(zoom, sc) };
}
/** MAPSFXSEAT: this seat's log of every lettering call (for the checks and the two-seat takes): the table's word and how this seat drew it */
function logCall(w, call) {
  const r = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : v ?? null), P = (q) => (q ? { x: r(q.x), y: r(q.y) } : null);
  seatLog.push({ seat: game.user?.id ?? "", key: w.key ?? `${w.seed}|${w.role}`, text: w.text, role: w.role, space: call.space ?? "world", seed: w.seed,
    ts: Math.round(w.ts ?? toShared(w.t)), size: r(call.table?.size), at: P(call.table?.at), drawn: r(call.o?.size), seatAt: P(call.o?.at),
    rule: call.fit?.rule ?? "ok", rules: call.fit?.rules ?? [], k: r(call.fit?.k ?? 1), cap: r(call.fit?.cap), clean: call.fit?.clean ?? null,
    box: call.box ? [r(call.box.x0), r(call.box.y0), r(call.box.x1), r(call.box.y1)] : null, played: Math.round(toShared(performance.now())),
    layer: call.o?.layer ?? null, lang: lang(),
    // (MAPDIRECT: the word's way, the look it gave, this seat's shares of its knock; a stream's flight direction)
    ...(w.way ? { way: [w.way.ux, w.way.uy], from: Number.isFinite(call.o?.from) ? call.o.from : null, rot: r(call.o?.rotation), knock: call.knock ? [call.knock.fit.kb, call.knock.fit.kv, call.knock.fit.kf, call.knock.fit.ko] : null } : {}),
    ...(Number.isFinite(call.dir) ? { dir: call.dir } : {}) });
  if ( seatLog.length > 600 ) seatLog = seatLog.slice(-400);
}
/** a table word this seat does not draw, by one of its own needs (logged like a call) */
function seatSkip(w, why) {
  seatLog.push({ seat: game.user?.id ?? "", key: w.key ?? `${w.seed}|${w.role}`, text: w.text, role: w.role, ts: Math.round(w.ts ?? toShared(w.t)), rule: why, skipped: true });
  if ( seatLog.length > 600 ) seatLog = seatLog.slice(-400);
}

function play(w) {
  const g0 = gen;
  const go = () => {
    if ( g0 !== gen || !L || mode() === "off" || !canvas?.ready || stepFor(grpOf(w)) === 0 ) return;
    if ( lifeOver(w) ) { stats.late++; seatSkip(w, "late"); return; }
    // a fire's catch / flare word whose fire went out (or was taken back) meanwhile: not lettered (FXLM 4)
    if ( w.obj && !C.fireEventLive({ obj: w.obj, voice: w.voice }, Fire.allStrokes?.()?.get(w.obj), sharedNow()) ) { stats.stale++; seatSkip(w, "stale"); return; }   // (MAPSEATS3: logged - ADVM r2 item 7, a fire word one seat drew and the other left no trace of)
    let h, call = null;
    try {
      if ( w.stream ) h = playStream(w);
      else { call = seatCall(w); if ( !call.o ) { seatSkip(w, call.fit?.rule === "noroom" ? "noroom" : "off"); return; } h = L.play(w.text, call.o); }
    } catch ( err ) { console.warn(`${MODULE_ID} | sfx: a word did not play`, err); return; }
    if ( !h ) return;
    stats.words++;
    if ( call?.knock ) call.knock.h = h;
    if ( call ) logCall(w, call);
    // (a travelling PRE word - a bomb's fall, a rocket's flight - is gone before the main word's flash frame: SPEC-EFFECTS 4.4)
    if ( Number.isFinite(w.stopAt) ) { const g1 = gen; setTimeout(() => { if ( g1 === gen ) { try { h.stop(); } catch {} } }, Math.max(0, w.stopAt - performance.now())); }
    // (EFFECTS2: a cave-in's word sinks as it holds, so what it covers reaches half its height lower; REQUESTS EFFECTS2-4)
    const b0 = call?.box ?? w.box, bx = b0 && w.voice === "cavein" ? { ...b0, y1: b0.y1 + (b0.y1 - b0.y0) * 0.5 } : b0;
    const ts0 = w.ts ?? toShared(w.t), rec = { box: bx, h, obj: w.obj, voice: w.voice, grp: w.group ?? null, life: [ts0, ts0 + lifeMs(w)] };
    alive.add(rec);
    keepStorm(w, h);
    Promise.resolve(h.finished).finally(() => alive.delete(rec));
    // (MAPRIDE: a burning run gives way to an event word at once - burnRooms keeps the runs off the words this seat drew; live a close
    // strike's KRRRMMM! stood a second on a run's phrase)
    if ( burns.size && bx ) scheduleBurn(60);
  };
  const wait = w.t - performance.now();
  if ( wait > 4 ) later(`w|${w.seed}|${w.role}|${w.t}`, wait, go, { obj: w.obj, voice: w.voice }); else go();
}

/** A gun's rattle: one syllable per round where and when it lands (its walk), one look for the whole burst (the engine's stream). */
function playStream(w) {
  const W = w.stream.walk, t0 = w.stream.t0;
  // (MAPEDGE: at most STREAM_ROWS syllables legible at once - thinned on the table's beats, the same on every seat - so the engine's lanes
  // stand in front of the source, not off the window behind it)
  const beats = SEAT.thinBeats(C.streamBeats(W)), rows = SEAT.streamRows(beats);
  const at = () => {
    const ms = performance.now() - t0;
    let i = 1; while ( i < W.length - 1 && W[i].ms < ms ) i++;
    const a = W[i - 1], b = W[i] ?? a, f = b.ms > a.ms ? Math.min(1, Math.max(0, (ms - a.ms) / (b.ms - a.ms))) : 1;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  };
  const { material } = C.wordOpts({ voice: w.voice, kind: w.kind, loud: w.loud, emat: w.emat, mat: w.mat, lang: lang() });
  const dir = Number.isFinite(w.stream.dir) ? w.stream.dir : -90, step = streamStep(grpOf(w), { space: "world", area: w.area, magnitude: w.magnitude });
  // MAPEDGE, THE SEAT RULE FOR A STREAM (sfx-seat streamSeat): a source this seat's view holds letters where it is; one off this view (a
  // shooter above the player's view) letters at the view's edge toward it, OFF_K of its size, its syllables running into the view, off
  // this seat's panels - before, streams bypassed the seat rule and the player's DRRT stood at the top edge, cut (ADVM r2 item 5)
  let unit = 0;
  try { unit = L.streamUnit?.({ space: "world", area: w.area, magnitude: w.magnitude, ...step })?.unit ?? 0; } catch { unit = 0; }
  const zoom = canvas.stage?.scale?.x || 1;
  let seat = null, seatT = -Infinity, kFix = null;
  const seatNow = () => {
    const pn = performance.now();
    if ( !seat || pn - seatT > 120 ) { try { seat = SEAT.streamSeat(at(), { view: mapView(), unit, panels: uiBoxes(), dir, zoom, rows, scale: kFix }); } catch { seat = { rule: "ok", at: at(), dir, k: 1 }; } seatT = pn; }
    return seat;
  };
  const first = seatNow(), k = first.k ?? 1;
  kFix = k;
  const to = () => { const s = seatNow(), a = (s.dir * Math.PI) / 180; return { x: s.at.x + Math.cos(a) * 1000, y: s.at.y + Math.sin(a) * 1000 }; };
  const h = L.stream({ kind: w.kind, ...(material ? { material } : {}), lang: lang(), space: "world", at: () => seatNow().at, to, dir, beats, startAt: t0, area: w.area, magnitude: w.magnitude, seed: w.seed,
    ...(w.colors ? { colors: w.colors } : {}), loud: (i) => 0.7 + 0.3 * Math.sin(i * 1.7), reduced: reducedMotion(), ...layerOpts(),
    ...step, ...(k !== 1 ? { scale: k } : {}) });
  // (logged like a word - api.sfx.log(): the two-seat takes compare what each seat drew)
  if ( h ) logCall({ ...w, text: w.text ?? w.kind }, { o: { size: unit * k, at: first.at, layer: layerOpts().layer ?? null }, fit: { rule: first.rule, rules: [first.rule], k, cap: unit * k }, box: null, table: { size: unit, at: at() }, space: "stream", dir });
  return h;
}
/** SFXSIZE: a stream's options at its group's size step ({} at today's size): the engine's stream takes no `scale`, so its syllable
    unit is passed stepped (sfx-size.mjs streamOpts) */
function streamStep(grp, base) {
  const st = stepFor(grp);
  if ( st === SZ.SIZE_DEFAULT || st === 0 || !L?.sizeOf ) return {};
  try { return SZ.streamOpts(L.sizeOf("A", { ...base, fit: "world" })?.natural, st); } catch { return {}; }
}

/* ---------------------------------------------------------------- lifecycle */

function teardown(full = true) {
  gen++;
  clearTimeout(gatherTimer); gatherTimer = 0; pending = [];
  for ( const s of sched.values() ) clearTimeout(s.id);
  sched.clear(); gated.clear(); if ( full ) shownAt.clear(); alive.clear(); seenEntry.clear(); fireSeen = new Map(); recent = []; shooters = [];
  pages.clear(); owned = { d: new Set(), f: new Set(), catch: new Set(), out: new Map() }; firingsSeen = null;
  detonating = null; ploughs.clear(); soon = []; flashSeen.clear(); clearTimeout(stormTimer); stormTimer = 0;
  clearTimeout(burnTimer); burnTimer = 0;
  for ( const b of burns.values() ) for ( const s of b.subs ) { try { s.stop({ quick: true }); } catch {} }
  burns.clear(); burnOrder = []; spoken.clear(); rimMemo.clear(); ledger.clear(); pageWaits.clear(); holdMemo.clear();
  fights.clear(); stormUp.clear(); closeMemo = { key: "", rp: null, m: new Map() }; onsetSeen.clear(); steamSeen.clear();
  uiCache = { t: -1e9, rects: [], boxes: [] };
}
function refresh() {
  // (SFXSIZE: destruction at size 0 takes its hooks off the display - nothing is computed per entry)
  const noDestr = mode() === "off" || stepFor("destruction") === 0;
  sfxBus.entry = noDestr ? null : onEntry;
  sfxBus.fireShown = mode() === "off" ? null : onFireShown;
  sfxBus.detonate = noDestr ? null : onDetonate;
  if ( mode() === "off" ) {
    for ( const s of sched.values() ) clearTimeout(s.id);
    sched.clear(); gated.clear(); pending = [];
    for ( const b of burns.values() ) for ( const s of b.subs ) { try { s.stop({ quick: true }); } catch {} }
    burns.clear(); burnOrder = []; spoken.clear();
  } else if ( canvas?.ready ) {
    fireSeen = new Map(Fire.allStrokes?.() ?? new Map()); onFire(true);
    // the engine (and its fonts) loaded once the scene is up, off the load path: the first crash of a session is lettered on time
    if ( !L ) { const g0 = gen; setTimeout(() => { if ( g0 === gen ) engine(); }, 2500); }
    else scheduleBurn(0);
    if ( !stormTimer ) pollStorm();
  }
}

/** SFXSIZE: a group's size step changed (the GM moved its slider; every seat gets the world setting): what is waiting for that group
    and its burning sounds follow at once - at 0 they stop, at another step the burning restarts at its new size, the next words take it. */
function sizeChanged(g) {
  if ( g === "fire" ) { clearTimeout(burnTimer); burnTimer = 0; for ( const b of burns.values() ) for ( const s of b.subs ) { try { s.stop({ quick: true }); } catch {} } burns.clear(); }
  if ( stepFor(g) === 0 ) {
    for ( const [k, s] of sched ) if ( s.voice && SZ.groupOfVoice(s.voice) === g ) { clearTimeout(s.id); sched.delete(k); }
    pending = pending.filter((e) => SZ.groupOfVoice(e.voice) !== g);
    if ( g === "fire" ) gated.clear();
  }
  firingsSeen = null;
  refresh();
}

export const sfxApi = {
  /** How it stands: events seen, clusters, words played / dropped / late / stale, planning ms, interface ms, burning sounds, words alive. */
  status: () => ({ mode: mode(), lang: lang(), layer: layerOpts().layer, sizes: Object.fromEntries(SZ.SIZE_GROUPS.map((g) => [g, stepFor(g)])), engine: L?.version ?? null, alive: alive.size, waiting: sched.size, gated: gated.size, pages: pages.size, ...stats }),
  /** The pages of the scene's preset firings (EFFECTS1): their words (role, kind, moment, rank) and what they keep silent. */
  pages: () => [...pages.values()].map((p) => ({ fid: p.rec.id, preset: p.rec.preset, main: p.pg.main, ground: p.ground, words: p.pg.words.map((w) => ({ key: w.key, role: w.role, kind: w.kind, t: w.t, rank: w.rank })),
    owned: { d: p.pg.owned.d.size, f: p.pg.owned.f.size, catch: p.pg.owned.catch.size, out: p.pg.owned.out.size } })),
  /** Plan (no play) the words of events [{ voice, x, y, r, t?, key? }] here and now: for checks and the docs. */
  plan: (events) => C.cluster(events.map((e, i) => ({ key: `p${i}`, t: performance.now(), ...e })), grid())
    .flatMap((g) => C.planCluster(g, { grid: grid(), sec: (C.CAPS[perfMode()] ?? C.CAPS.high).sec, seed: canvas.scene?.id ?? "", known })),
  /** Play events now (scene px): `api.sfx.test([{ voice: "crash", x, y, r: 300 }])`. */
  test: (events) => { const t = performance.now() + 30; for ( const [i, e] of events.entries() ) add({ key: `test|${Date.now()}|${i}`, t, ...e }); },
  /** The interface panels this client keeps words off (client px), and the fire sounds burning. */
  ui: () => uiCache.rects, placed: () => lastPlaced.slice(), burns: () => [...burns.entries()].map(([k, b]) => ({ key: k, live: b.live, n: b.subs.length, idx: b.idx })), burnLines: () => burnLog.slice(),
  /** MAPSFXSEAT: this seat's log of every lettering call (the table's word - text, seed, size, place, shared moment - and the seat rule it
      was drawn by); `clear` empties it. The table picture's words (the ledger: key, box, life on the shared clock). */
  log: ({ clear = false } = {}) => { const l = seatLog.slice(); if ( clear ) seatLog = []; return l; },
  table: () => ledger.list.map((q) => ({ ...q })),
  /** GMALLMAPS: the table's lettering options as this seat applies them; `open()` shows their window */
  prefs: () => tableNow(), open: () => UI.open(),
  core: C
};

/* GMALLMAPS: the table's lettering options. A player's own write of one is cancelled on his seat with a notice (the server would refuse
   it anyway, with an error); a reset (the GM's "Defaults") deletes the documents, which fires no onChange: follow it here. */
function guardWrite(doc, change) {
  const key = String(doc?.key ?? change?.key ?? "");
  if ( !key.startsWith(`${MODULE_ID}.`) ) return true;
  if ( PF.mayWrite(key.slice(MODULE_ID.length + 1), game.user?.isGM) ) return true;
  ui.notifications?.warn(game.i18n.localize("MOINENMAPS.Sfx.table.refused"));
  return false;
}
function onDeleted(doc) {
  const key = String(doc?.key ?? "");
  if ( !key.startsWith(`${MODULE_ID}.`) || !PF.TABLE_KEYS.includes(key.slice(MODULE_ID.length + 1)) ) return;
  for ( const g of SZ.SIZE_GROUPS ) if ( key.endsWith(`.${SZ.SIZE_SETTING[g]}`) ) { sizeChanged(g); UI.follow(); return; }
  refresh(); UI.follow(); fixWords();
}
/* MAPWIN: the table's word set is NAMED ("en" / "pl") by the active GM's seat, from its interface language, whenever the world holds
   none: at ready (a new world), and at once when the value turns "auto" again (a deleted document, a macro, an older window's
   "Defaults"). Until then every seat letters the shared set (sfx-prefs wordsOf), so seats in two languages never letter two words. */
let fixing = false;
async function fixWords() {
  if ( fixing || !game.user?.isActiveGM || PF.WORD_SETS.includes(get("sfxWordsWorld", "auto")) ) return false;
  fixing = true;
  try { await game.settings.set(MODULE_ID, "sfxWordsWorld", PF.wordsFor(game.i18n?.lang)); return true; }
  catch { return false; }
  finally { fixing = false; }
}
/* the migration (sfx-prefs migrationPlan), on the first GM seat after the update; a player is told once if his old values differed */
const worldDoc = (k) => { try { return game.settings.storage?.get("world")?.getSetting?.(`${MODULE_ID}.${k}`, null) ?? null; } catch { return null; } };
const localOld = (k) => { try { return PF.parseLocal(globalThis.localStorage?.getItem(`${MODULE_ID}.${k}`)); } catch { return undefined; } };
async function migrate() {
  if ( !game.user?.isGM ) return null;
  const plan = PF.migrationPlan({ world: (k) => { const d = worldDoc(k); return d ? PF.docValue(d) : undefined; }, local: localOld, done: get(PF.MIGRATED_KEY, 0) });
  if ( !plan.run ) return plan;
  for ( const [k, v] of Object.entries(plan.writes) ) await game.settings.set(MODULE_ID, k, v);
  await game.settings.set(MODULE_ID, PF.MIGRATED_KEY, PF.MIGRATION);
  const keys = Object.keys(plan.writes);
  if ( keys.length ) {
    console.info(`${MODULE_ID} | sfx: the map lettering options are the table's now; taken over: ${keys.map((k) => `${k} = ${plan.writes[k]} (${plan.from[k]})`).join(", ")}`);
    ui.notifications?.info(game.i18n.localize("MOINENMAPS.Sfx.table.migrated"));
  }
  return plan;
}
function noticeOnce() {
  try {
    if ( game.user?.isGM ) return;
    const ls = globalThis.localStorage; if ( !ls || ls.getItem(PF.NOTICE_LS) !== null ) return;
    ls.setItem(PF.NOTICE_LS, String(Date.now()));
    if ( PF.playerDiffers(localOld, tableNow()) ) ui.notifications?.info(game.i18n.localize("MOINENMAPS.Sfx.table.moved"));
  } catch {}
}
/** the lettering engine's own table window (its look and motion, shared by every module that letters), or null without one */
async function engineMenu() {
  try { const e = L ?? await letters(); if ( typeof e?.openSettings === "function" ) { await e.openSettings(); return true; } } catch {}
  return false;
}
/** the table's lettering as this seat applies it (sfx-prefs tableOf over the world values) */
export const tableNow = () => PF.tableOf((k) => get(k, PF.TABLE[k]?.def));

export function registerSfx() {
  moduleApi.sfx = sfxApi;
  Hooks.once("init", registerSettings);
  Hooks.once("ready", async () => {
    refresh(); const m = game.modules.get(MODULE_ID); if ( m?.api ) m.api.sfx ??= sfxApi;
    // GMALLMAPS: the GM's own old choices become the table's (once per world), before the word set is fixed below
    if ( game.user?.isActiveGM ) { try { await migrate(); } catch ( err ) { console.warn(`${MODULE_ID} | sfx: migration`, err); } }
    noticeOnce();
    // the world's word set is named by the active GM's seat from its language (then, and until then, every seat letters the same words)
    await fixWords();
  });
  // (canvasTearDown cleared the old scene; at canvasReady the new scene's fire may already have shown its flames: kept)
  Hooks.on("canvasReady", () => { teardown(false); refresh(); });
  Hooks.on("canvasTearDown", () => teardown(true));
  Hooks.on("preCreateSetting", guardWrite);
  Hooks.on("preUpdateSetting", guardWrite);
  Hooks.on("deleteSetting", onDeleted);
  UI.wire({ table: tableNow, guiLang: () => game.i18n?.lang, perf: () => perfMode(), reduced: () => reducedMotion(), engineMenu: engineMenu });
  Hooks.on("moinenMapsPresets", (kind, data) => { if ( kind === "firing" ) onFiring(data?.rec); });
  Hooks.on("moinenMapsWeather", (kind) => onWeather(kind));                     // (MAPTHUNDER: the rain's hiss on a fire)
  Hooks.on("moinenMapsFire", (kind) => { if ( kind === "edited" || kind === "loaded" ) { if ( kind === "loaded" ) { fireSeen = new Map(); onFire(true); } else onFire(false); } });
}
