/* LMAP / FXLM: COMIC SOUND EFFECTS of the map's destruction and fire, the runtime. What sounds (sfx-core.mjs plans it):
     - a damage area entering (destruction display.enter, through sfx/bus.mjs): every client plays the same entry (the scene flag's
       entries, a preset's shared clock, a cinematic show, a Detonate), so every client letters it too;
     - the fire layer's strokes (fire.mjs; the same strokes and the same shared clock on every client): a fire catching (when its
       flames show: MAPSFXSEAT lettered at the shared moment + CATCH_SHOW_MS on every seat), flaring up, going out, an explosion, ground dust, an eraser dousing fire;
     - a burning fire's CONTINUOUS sound for as long as it burns: the engine's sustain (a phrase score; a smoulder: its quiet ambient
       mode), riding the flame front while it runs along its path, its level following the fire's level.
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
   Settings: "sfxLetters" (client: all / big only / off), "sfxLettersWorld" (the GM's switch for everyone), "sfxWords" (client: the
   word set, auto = the game's language), "sfxLayer"; SFXSIZE: "sfxSizeDestruction" / "sfxSizeFire" / "sfxSizeWeather" (world, the
   GM's for the table, live: 0 none, 1 smaller, 2 today's size, 3 bigger; sfx-size.mjs; a player sees them read-only under
   "sfxLetters"). Reduced motion: the module's own rule (config.reducedMotion), passed on. */
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
import * as FIT from "./sfx-fit.mjs";
import * as SEAT from "./sfx-seat.mjs";
import * as T from "./sfx-table.mjs";
import { mapPixels } from "../destruction/source.mjs";
import { buildTimeline } from "../tokens/carry-core.mjs";
import { hitsOf } from "../tokens/plough-core.mjs";

const MAX_AHEAD = 120000;      // events further ahead than this (a preset timed minutes ahead) are not scheduled
const RUN_EPOCH = 30 * 60000;  // ms: a burning run's clock moves on by this much at a time (runClock)
const CLOCK_OK = 30, CLOCK_WAIT = 20000;  // ms: a seat's shared clock error a run joins on; how long after load a run waits for it
const BURN_AFTER = 1500;       // ms after a fire shows before its continuous sound starts (the catch word has the stage first)
const CATCH_SHOW_MS = T.CATCH_SHOW_MS;   // MAPSFXSEAT: a catch word sounds this long after its fire's shared moment (question MAPSFXSEAT-2)
const UI_MS = 400;             // the interface rectangles are measured at most this often
// a live fire's lasting word: the engine's sustain treatments WITHOUT "echo" (EFFECTS1, live: the echo copies sat stacked on
// the word itself, FOOOFF three times over one fire)
const BURN_TREATMENTS = ["breath", "stretch", "split", "shed", "accent"];

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
const burns = new Map();       // burn key -> { plan, live, subs: [sustain] }
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
// MAPSFXSEAT: the table picture (sfx-seat.mjs): the words every seat holds, planned from shared data; and this seat's own log of every
// lettering call (what it drew, where, how big, when, by which seat rule) for the checks and the two-seat takes
const ledger = SEAT.makeLedger();
let seatLog = [];
let screenUp = [];              // MAPSFXSEAT2: this seat's unlocated words still up ({ box (CSS px), life [t0, t1] shared ms }): a new one keeps off them
const holdMemo = new Map();     // word + look -> the engine's hold box (a page plans many words in one frame)
const pageWaits = new Map();    // firing id -> the shared moment its page stops waiting for its strokes
const PAGE_WAIT_MS = 4000;      // a page waits this long (shared ms after its firing's moment) for all its fire-layer strokes
const stats = { events: 0, clusters: 0, words: 0, dropped: 0, late: 0, stale: 0, ms: 0, uiMs: 0, burns: 0 };

/* ---------------------------------------------------------------- settings */

const get = (k, d) => { try { return game.settings.get(MODULE_ID, k); } catch { return d; } };
export const mode = () => (get("sfxLettersWorld", true) === false ? "off" : get("sfxLetters", "all"));
// (every seat must see the same word for the same moment: "auto" follows the WORLD's word set, which the GM's language sets once)
const lang = () => { const c = get("sfxWords", "auto"); return C.langOf(c !== "auto" ? c : get("sfxWordsWorld", "auto"), game.i18n?.lang); };
// SFXSIZE: the size step of a group's lettering (sfx-size.mjs; world settings, the GM's for the table: every seat letters the same)
export const stepFor = (g) => SZ.stepOf(get(SZ.SIZE_SETTING[g], SZ.SIZE_DEFAULT));
const grpOf = T.grpOf;

function registerSettings() {
  const T = (k) => `MOINENMAPS.Sfx.${k}`;
  game.settings.register(MODULE_ID, "sfxLetters", { name: T("set"), hint: T("setHint"), scope: "client", config: true, type: String, default: "all",
    choices: { all: T("all"), big: T("big"), off: T("off") }, onChange: () => refresh() });
  game.settings.register(MODULE_ID, "sfxLettersWorld", { name: T("world"), hint: T("worldHint"), scope: "world", config: true, restricted: true, type: Boolean, default: true, onChange: () => refresh() });
  // SFXSIZE: the lettering's size per group, chosen by the GM for the table (0 none, 1 smaller, 2 today's size, 3 bigger); live
  for ( const g of SZ.SIZE_GROUPS ) game.settings.register(MODULE_ID, SZ.SIZE_SETTING[g], { name: T(`size.${g}`), hint: T(`size.${g}Hint`), scope: "world", config: true,
    restricted: true, type: Number, default: SZ.SIZE_DEFAULT, range: { min: 0, max: 3, step: 1 }, onChange: () => sizeChanged(g) });
  // (the lettering engine's world layers, LETR contract v3)
  game.settings.register(MODULE_ID, "sfxLayer", { name: T("layer"), hint: T("layerHint"), scope: "client", config: true, type: String, default: "overlay",
    choices: Object.fromEntries(LAYER_IDS.map((k) => [k, T(`layers.${k}`)])) });
  game.settings.register(MODULE_ID, "sfxWords", { name: T("words"), hint: T("wordsHint"), scope: "client", config: true, type: String, default: "auto",
    choices: { auto: T("wordsAuto"), en: T("wordsEn"), pl: T("wordsPl") } });
  game.settings.register(MODULE_ID, "sfxWordsWorld", { name: T("wordsWorld"), hint: T("wordsWorldHint"), scope: "world", config: true, restricted: true, type: String, default: "auto",
    choices: { auto: T("wordsAuto"), en: T("wordsEn"), pl: T("wordsPl") } });
}

/** The engine's world layers (LETR contract v3), bottom to top. */
export const LAYER_IDS = ["ground", "tokens", "weather", "overlay", "top"];
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
  const shot = !!walk && hasShooter(walk, pn);
  const ev = C.entryEvent(I, o, ap, start, { speed, gun: walk, ride, shot, key: `d|${g.hash}|${Math.round(start)}`, sid: `d|${g.hash}`, objId: g.objId ? `d${g.objId}` : null,
    from: p0 ? { x: o.x + p0[0] * ap, y: o.y + p0[1] * ap } : null });
  add(ev);
  // (EFFECTS2: a big blast or cave-in throws debris that lands after it, by the ground's material)
  for ( const f of C.brushFalls(ev, grid(), k2 * (causeLook(I.cause)?.slow ?? 1)) ) add(f);
}

/** A gun's pocks are a shooter's rounds (a firing from a token here, lately): its first hit lands on one of the shooter's hits. */
function hasShooter(walk, now) {
  shooters = shooters.filter((q) => q.t1 > now);
  const g = grid(), w0 = walk[0];
  return shooters.some((q) => q.pts.some((h) => Math.hypot(h[0] - w0.x, h[1] - w0.y) < g * 0.75));
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
    shooters.push({ pts: it.hits.map((h) => [h[0], h[1]]), t1: t0 + last + 6000 });
    reported = true;
    const e = C.muzzleEvent(it, { t0, grid: G, muzzleOf: A.muzzleOf, flight, key: `m|${rec.id}|${i}`, sid: `m|${rec.id}|${i}` });
    if ( !e ) return;
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
    screenReport(walk, t0 + first - 120, C.gunKinds(walk), `m|${rec.id}|off`);
  }
}

/* ---------------------------------------------------------------- EFFECTS2: plough, Detonate, lightning */

/** A story that is not a preset firing (a plough, a flash): a page of its own words, played like a firing's (pageWord). */
function storyPage(id, t0, words, ground = null, grp = null) {
  const p = { rec: { id, t0, size: 1 }, pg: { words }, ground, grp };
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
    const place = W.stormModel?.placeOf?.(ev, rect, G);
    if ( !place ) continue;
    const w = EV.flashWord(ev, place, view(), canvas.scene?.id ?? "");
    if ( !w ) continue;
    const r = G * 0.5;
    const p = storyPage(`flash|${id}`, ev.t, [{ ...w, key: w.role, ...(w.screen ? {} : { box: { x0: w.x - r, y0: w.y - r * 0.4, x1: w.x + r, y1: w.y + r * 0.4 }, side: C.h01(`${w.seed}|s`) < 0.5 ? -1 : 1 }) }], null, "weather");
    // (MAPRIDE: when its word is due, the flash is asked again with the storm as it stands THEN - the GM's change reaches his own seat at
    // once and a player's a moment later, so a seat that polled before the change and one that polled after decided differently)
    if ( !ev.preview ) p.still = () => flashStill(ev);
    stats.flashes = (stats.flashes ?? 0) + 1;
  }
  again(700);
}
/** MAPRIDE: is a lightning flash still one this storm makes and letters, read with the storm's settings as they stand now on this seat (a
    switch-off that reached this seat after its poll: the flash is gone, on every seat alike)? No storm shown here: as polled. */
function flashStill(ev) {
  try {
    const storm = moduleApi.weather?.stormDisplay?.(), SM = moduleApi.weather?.stormModel;
    if ( !storm?.S || !SM?.flashOf ) return true;
    const now = SM.flashOf(storm.S, storm.seed, ev.k, storm.rainP);
    if ( !now || now.kind !== ev.kind || now.t !== ev.t ) return false;
    return ev.kind !== "far" || EV.farLettered(now, (k) => farBefore(storm, k));
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
  for ( const d of rec.d ?? [] ) if ( d?.id ) owned.d.add(d.id);
  for ( const e of rec.f ?? [] ) if ( e?.id ) { owned.f.add(e.id); owned.catch.add(e.id); }
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
/** MAPSAME: a page's table and this seat's layout of it for the current view, made ahead (groupLayout keeps it while the view holds) */
function prepPage(p) {
  try {
    if ( mode() === "off" || !L || !canvas?.ready || !pages.has(p.rec.id) ) return;
    tablePage(p);
    if ( p.group?.words?.length ) groupLayout(p.group, view(), canvas.stage?.scale?.x || 1, L.prefs?.scale ?? 1);
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
    by the seat rule only (pageWord -> play / playScreen). */
function tablePage(p) {
  if ( p.table || !L ) return p.table ?? null;
  p.table = T.planPage(p, tdeps());
  // (the page's located words are one picture: a seat lays them out together - sfx-seat seatLayout: each keeps its side of what it letters,
  // none onto another)
  p.group = { words: [...(p.table?.values() ?? [])].filter((q) => q && !q.dropped && !q.screenAt && !q.stream && Number.isFinite(q.x) && Number.isFinite(q.y)) };
  for ( const q of p.group.words ) q.group = p.group;
  return p.table;
}
/** One word of a page, at its moment, on THIS seat: the table's word, shown by the seat rule (its view, its panels, what it may see). */
function pageWord(p, w) {
  if ( mode() === "off" || !canvas?.ready ) return;
  if ( !L ) { engine(); return; }
  const tb = tablePage(p);
  if ( mode() === "big" && w.role !== "main" ) return;
  const grp = SZ.groupOfPageWord(w, p.grp);
  if ( stepFor(grp) === 0 ) return;
  const q = tb?.get(w.key);
  if ( !q ) return;
  if ( p.still && !p.still() ) { seatSkip(q, "gone"); return; }
  if ( q.dropped ) { stats.dropped++; lastPlaced.push({ text: q.text, role: w.role, key: w.key, dropped: q.dropped, why: q.why }); trimPlaced(); return; }
  // (this seat's own need: its performance mode keeps fewer words up - never the main word)
  const caps = C.CAPS[perfMode()] ?? C.CAPS.high;
  if ( w.role !== "main" && alive.size >= caps.alive ) { stats.dropped++; seatSkip(q, "perf"); return; }
  // (owner's answer 4: a sound whose source this seat cannot see - under the fog, out of vision, a hidden shooter - is shown generally
  // on the screen, never at the hidden place; a flash beyond this seat's view sounds at the edge toward it)
  if ( q.screenAt ) { playScreen(q, q.screenAt); return; }
  if ( !hereVisible(q.sx ?? q.x, q.sy ?? q.y) ) { playScreen(q); return; }
  if ( w.from && !shooterSeen([w.from.x, w.from.y]) ) { playScreen(q); return; }
  play(q);
  lastPlaced.push({ text: q.text, role: q.role, voice: q.voice, page: p.rec.id, key: w.key, box: q.box, ...(q.fitK !== undefined ? { fitK: q.fitK } : {}), clean: FIT.isClean(q.pen) });
  trimPlaced();
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
    const f = SEAT.seatLayout([item], { view: { x0: 0, y0: 0, x1: W, y1: H }, panels: [...(uiCache.rects ?? []), ...screenUp.filter((q) => q.life[0] < life[1]).map((q) => q.box)], pins: pinRects(), zoom: 1 }).get("s");
    const at = SEAT.layoutAt({ x: ref.x + off.x, y: ref.y + off.y }, f);
    const oo = { ...o, at, size: f.cap / ((plan?.sizeK ?? 1) * sc), startAt: spec.t, reduced: reducedMotion() };
    try {
      const h = L.play(spec.text, oo);
      if ( h ) { stats.words++; stats.unlocated = (stats.unlocated ?? 0) + 1; screenUp.push({ box: f.box, life }); logCall(spec, { o: oo, fit: { ...f, k: oo.size / o.size }, box: f.box, table: { size: o.size, at: { x: ref.x, y: ref.y } }, space: "screen" }); }
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
  const ctx = { grid: G, burning: (er) => burningList.some((f) => overlapsStroke(f, er)), late: 1500, newLate: first ? 0 : C.NEW_LATE,
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

/* ---------------------------------------------------------------- a burning fire's continuous sound */

function scheduleBurn(ms) { clearTimeout(burnTimer); const g0 = gen; burnTimer = setTimeout(() => { burnTimer = 0; if ( g0 === gen ) reconcileBurn(); }, ms); }
/** Which fires burn and are shown here: each group gets its continuous sound (live for the biggest in view, ambient for the rest). */
function reconcileBurn() {
  const want = new Map();
  const on = mode() === "all" && Fire.shownHere?.() && canvas?.ready && stepFor("fire") > 0;
  if ( on && L?.sustain ) {
    const now = sharedNow(), G = grid(), caps = C.CAPS[perfMode()] ?? C.CAPS.high;
    // (MAPSFXSEAT: the table's fires - burning since their shared catch moment + BURN_AFTER, on every seat alike; before, from when its
    // flames first showed HERE, so a busy seat started a fire's sound seconds later, with other spots and phrases)
    const fires = [...(Fire.allStrokes?.() ?? new Map()).values()].filter((s) => s.k === "fire" && FM.burningAt(s, now) && Number(s.g ?? s.q ?? 0) + BURN_AFTER <= now);
    const geo = Fire.geo(), P = Fire.params0();
    // (MAPRIDE: each run's own clock - the shared instant its group began to burn - so its size, its level and its phrases are the same on
    // every seat, a seat that joins late included: before, the size and level were read at this seat's own start, up to a second apart)
    const plans = C.burnGroups(fires, G).map((g) => ({ ...C.burnPlan(g, { grid: G, catchMs: (st) => FM.catchMs(st, geo, P), levelNow: (s, t) => FM.levelNow(s, Number.isFinite(t) ? t : undefined) }),
      start: Math.min(...g.map((s) => Number(s.g ?? s.q ?? 0))) + BURN_AFTER }))
      .sort((a, b) => b.prio - a.prio);
    let live = 0;
    const spots = [];
    for ( const p of plans ) {
      // (the TABLE's live fires: the biggest ones, the same on every seat - not the biggest in this seat's view; this seat's performance
      // mode keeps fewer of them live, the rest burn quietly: its own need)
      const isLive = p.live && live < Math.min(caps.live, C.CAPS.high.live);
      // (a smaller fire whose phrases would sit on a bigger one's: heard in the bigger one's phrases, not lettered on top of them; the
      // table's phrase size - this seat's own lettering size setting moves its phrases off its panels only)
      const all = p.points.map((_, i) => p.at(i, now)), em = burnSize(p, isLive) * 1.25;
      // (THUNDERFIT: the spots of ONE fire crowd each other too when its phrases are big for the way its path runs on this screen - a far
      // zoom, a bigger size step: live their phrases stood on each other; the first spot stays, a spot on an earlier one is heard in it)
      const idx = C.burnSpots(all, em), pts = idx.map((i) => all[i]);
      if ( C.burnCrowded(pts, spots, em) ) continue;
      spots.push(...pts.map((q) => ({ x: q.x, y: q.y, em })));
      if ( isLive ) live++;
      want.set(p.key, { plan: p, live: isLive, idx });
    }
  }
  // (MAPRIDE: this seat's room for every run, in the table's order: a run never letters into one laid out before it; a spot with no clean
  // room on this seat is not lettered here)
  const rooms = burnRooms(want);
  for ( const w of want.values() ) { const r = rooms.get(w.plan.key) ?? []; w.seat = w.idx.filter((i) => r[i]?.ok !== false); w.sig = `${w.seat.map((i) => `${i}:${Math.round((r[i]?.f ?? 1) * 100)}`).join()}@${runClock(w.plan)}`; }
  for ( const [k, b] of burns ) {
    const w = want.get(k);
    // (MAPRIDE: a run this seat now letters at another size - the room round it changed - starts again at the new size, on the shared clock)
    if ( w && w.live === b.live && w.sig === b.sig ) { b.plan = w.plan; b.off = rooms.get(k) ?? []; continue; }
    // gone out / removed: its words play their exits (the fire's last breath before the hiss); switched mode: at once
    for ( const s of b.subs ) { try { s.stop({ quick: !!w }); } catch {} }
    burns.delete(k);
  }
  // (MAPRIDE: a live run joins the shared clock only once this seat's clock has settled - live a player just after a reload was ~280 ms
  // off with the clock "ready" (ENGVIEW-1); its run waits a second or two for it, at most CLOCK_WAIT after the page loaded)
  const clockLate = (L?.clock?.error?.() ?? 0) > CLOCK_OK && performance.now() < CLOCK_WAIT;
  for ( const [k, w] of want ) if ( !burns.has(k) && w.seat.length && !(w.live && clockLate) ) { const b = { plan: w.plan, live: w.live, idx: w.seat, sig: w.sig, off: rooms.get(k) ?? [], subs: [] }; burns.set(k, b); b.subs = startBurn(w.plan, w.live, w.seat); }
  stats.burns = burns.size;
  if ( burns.size || (stepFor("fire") > 0 && [...(Fire.allStrokes?.() ?? new Map()).values()].some((s) => s.k === "fire")) ) scheduleBurn(1000);
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
    const now = sharedNow(), v0 = view(), z = canvas.stage?.scale?.x || 1, m = SEAT.SEAT_EDGE / z;
    const v = { x0: v0.x0 + m, y0: v0.y0 + m, x1: v0.x1 - m, y1: v0.y1 - m };
    // (panels are hard for a run, not a 6 % share as for a word: 6 % of a run's tall block is a whole phrase hidden at its edge - live, the
    // player's FOOOOOMF ran under the challenges panel)
    // (and off the words THIS seat drew where they stand here - the seat layout moves them from the table's place: live the player's
    // KA-BOOOOM!! stood where a run then lettered; a run that started first moves off within its next second)
    const soft = [...ledger.boxes(now, now + 1000), ...[...alive].map((r) => r.box).filter(Boolean)], hard = [...uiBoxes(), ...pinBoxes(v0), ...tokenBoxes(v0)], taken = [];
    const maxShift = Math.max(v.x1 - v.x0, v.y1 - v.y0) * 0.45;
    for ( const [key, w] of want ) {
      const p = w.plan, sc = L?.prefs?.scale ?? 1, k = burnSize(p, w.live) * sc, arr = [], st = stepFor("fire");
      // (smaller on this seat where the table's size has no clean room - down to the legibility floor of its window, never under it -,
      // laid out from the lower steps up so a higher step never letters a run smaller: sfx-seat burnRoom; question MAPRIDE-3)
      const kMin = Math.min(k, SZ.floorPx(globalThis.innerHeight || 900, 1, L.sizeModel) / z), below = [1, 2, 3].filter((s) => s < st).map((s) => burnSize(p, w.live, s) * sc);
      // (a spot off this screen stays where it is: its words are not pulled into view, and it takes no room here)
      const on = w.idx.filter((i) => { const q = p.at(i, now); return q.x > v0.x0 && q.x < v0.x1 && q.y > v0.y0 && q.y < v0.y1; });
      // (MAPSAME: one whose run would still reach into this view, cut at its edge, is not lettered here - sfx-seat offSpot)
      const motion = L?.motionMode?.() === "stepped" ? "stepped" : "smooth";
      for ( const i of w.idx ) if ( !on.includes(i) ) arr[i] = { dx: 0, dy: 0, box: null, room: null, ok: SEAT.offSpot(p.at(i, now), k, v0, motion) === "out", off: true };
      const r = SEAT.burnRoom(on.map((i) => p.at(i, now)), { k, kMin, below, v, hard, soft, taken, maxShift, motion });
      on.forEach((i, j) => { arr[i] = { ...r[j], f: r[j].k / k }; if ( r[j].ok ) taken.push(r[j].box); });
      out.set(key, arr);
    }
  } catch ( err ) { console.warn(`${MODULE_ID} | sfx: a fire's room`, err); }
  return out;
}
/** The cap height (scene px) of a burning fire's words: a share of the REFERENCE view's height at the reference zoom (MAPSFXSEAT: the
    same size on every seat; live: 3.5..6 %, by the fire's level; ambient: 3 %) - its phrases sit over the flames for as long as they
    burn, so they stay a size under the event words (the engine's ceiling share, ceilK, does not reach continuous sounds: REQUESTS lmap) */
/** MAPRIDE: the clock a live run is lettered on: its group's shared start, carried forward by whole RUN_EPOCHs - the engine replays a
    clocked run's past phrases from its start (at most 10 000 of them, ~3 h; live a fire painted two days before never lettered at all),
    so a fire burning longer starts its run again at each epoch, on every seat at the same shared instant (reconcileBurn) */
function runClock(p, now = sharedNow()) {
  if ( !Number.isFinite(p.start) ) return NaN;
  return p.start + Math.floor(Math.max(0, now - p.start) / RUN_EPOCH) * RUN_EPOCH;
}
function burnSize(p, live, step = stepFor("fire")) {
  // (MAPRIDE: the level at the run's shared start, not this seat's now: the same size on every seat, one joining late too)
  const zoom = SEAT.refZoom(grid(), 0), lv = p.level(Number.isFinite(p.start) ? p.start : sharedNow());
  const px = SEAT.REF_VH * (live ? 0.035 + 0.03 * Math.min(1, lv / 0.9) : 0.03);
  // (SFXSIZE: at the fire group's size step; the phrase spacing and the panel shifts use this size too)
  return SZ.sizeAt(Math.max(4, px / zoom), step);
}
function startBurn(p, live, idx = null) {
  const seed = `${canvas.scene?.id ?? ""}|burn|${p.seedId}`, red = reducedMotion(), G = grid();
  const kind = C.kindOf("fire", known);
  // (each spot keeps its own index - its seed and its place on the path - whichever spots are lettered)
  return (idx ?? p.points.map((_, i) => i)).map((i) => {
    try {
      // (this seat's size for the run: the table's, or smaller where its room was short - burnRooms)
      const f = burns.get(p.key)?.off?.[i]?.f ?? 1, size = burnSize(p, live) * f, k = size * (L?.prefs?.scale ?? 1);
      // (MAPRIDE: a live run on the shared clock - `startAt` the instant its group began to burn, its level read at the phrase's own instant
      // of that clock (the engine passes ms since startAt) -, so every seat letters the same phrases at the same instants, a late one joins
      // mid-phrase; take startAt only once this seat's clock is good (moinen-letters lesson), else the run starts here as before)
      const clockOk = !(L?.clock?.error?.() > CLOCK_OK) || performance.now() >= CLOCK_WAIT, t0 = runClock(p), startAt = live && clockOk && Number.isFinite(t0) ? toPerf(t0) : undefined;
      return L.sustain({ kind, space: "world", at: () => { const b = burns.get(p.key), q = (b?.plan ?? p).at(i, sharedNow()), o = b?.off?.[i];
          return o ? { x: q.x + o.dx, y: q.y + o.dy } : q; },
        level: startAt !== undefined ? (ms) => p.level(t0 + (Number.isFinite(ms) ? ms : sharedNow() - t0)) : () => p.level(sharedNow()),
        ...(startAt !== undefined ? { startAt } : {}),
        // (the block this seat gave the run - burnRooms: the engine keeps the run inside it as one block - and its phrases to its width)
        room: () => burns.get(p.key)?.off?.[i]?.room ?? null, maxWidth: SEAT.RUN.mw * k,
        seed: `${seed}|${i}`, lang: lang(), area: Math.min(p.r, G * 1.2), dir: -90, size,
        ...(p.colors ? { colors: p.colors } : {}), glow: "auto", reduced: red, ...(live ? {} : { mode: "ambient" }), ...layerOpts(),
        // (EFFECTS1, FXLM2 leftover: the engine's "echo" treatment trails two copies of a phrase beside it - over a fire they sat on
        // the phrase itself and on the next one; a burning fire's phrases breathe, stretch, split, shed and flare, without the echo)
        ...(live ? { treatments: BURN_TREATMENTS } : {}),
        // (engine 1.7.0 pulls world words into the view by default: a fire burning off this screen must not letter at its edge; the
        // spots on screen are kept in view and off the panels by burnOffsets)
        keepInView: false });
    } catch ( err ) { console.warn(`${MODULE_ID} | sfx: a fire's sound did not start`, err); return null; }
  }).filter(Boolean);
}

/* ---------------------------------------------------------------- this client's screen */

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
function uiBoxes() {
  const now = performance.now();
  if ( now - uiCache.t < UI_MS ) return uiCache.boxes;
  const t0 = now, board = canvas.app?.view ?? document.getElementById("board");
  const rect = board?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
  let rects = [];
  try {
    rects = C.uiRects([...document.body.children], { style: (el) => getComputedStyle(el), vw: innerWidth, vh: innerHeight,
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
  gatherTimer = 0;
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
    let mine = big ? placed.filter((w) => w.role === "main" && (w.loud ?? 1) >= 0.2 + 0.8 * 0.34 - 1e-9) : placed;
    const secs = mine.filter((w) => w.role === "sec").sort((a, b) => a.t - b.t).slice(0, caps.sec);
    mine = C.capWords([...mine.filter((w) => w.role !== "sec"), ...secs], caps.alive - alive.size);
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
  const vw = view(), zoom = canvas.stage?.scale?.x || 1, sc = L.prefs?.scale ?? 1;
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
  // (reduced motion on this seat: a drifting or travelling word stands where the table's starts - as before, now as this seat's need)
  if ( oo.reduced && oo.path ) delete oo.path;
  return { o: oo, fit: { ...f, k: oo.size && o.size ? oo.size / o.size : 1 }, box: f.box, table: { size: o.size, at } };
}
/** this seat's window for the size model (the engine's own: the usable width leaves an open sidebar out) */
function seatView(zoom, sc) {
  const sb = document.getElementById("sidebar")?.getBoundingClientRect?.();
  return { vw: Math.max(320, innerWidth - (sb && sb.left > innerWidth * 0.5 ? sb.width : 0)), vh: innerHeight, zoom, scale: sc };
}
/** the seat layout of a group (a page's or a moment's located words; a word on its own is a group of one), once per view of this seat */
function groupLayout(grp, vw, zoom, sc) {
  const ui = uiBoxes();
  const key = vw ? `${Math.round(vw.x0)}|${Math.round(vw.y0)}|${Math.round(vw.x1)}|${Math.round(vw.y1)}|${ui.length}|${sc}|${innerWidth}x${innerHeight}` : "";
  if ( grp.seat && grp.seatKey === key ) return grp.seat;
  grp.seatKey = key;
  const d = tdeps(), items = T.seatItems(grp.words, d, seatView(zoom, sc));
  const pins = [...sharedPins(vw), ...pinBoxes(vw)];
  // (MAPRIDE: its cost on this seat - api.sfx.status().stats seatMs / seatN / seatMax - for live frame-time checks)
  const t0 = performance.now(), r = SEAT.seatLayout(items, { view: vw, panels: ui, pins, tokens: sharedTokens(vw), zoom }), ms = performance.now() - t0;
  stats.seatMs = (stats.seatMs ?? 0) + ms; stats.seatN = (stats.seatN ?? 0) + 1; stats.seatMax = Math.max(stats.seatMax ?? 0, ms);
  return (grp.seat = r);
}
/** MAPSFXSEAT: this seat's log of every lettering call (for the checks and the two-seat takes): the table's word and how this seat drew it */
function logCall(w, call) {
  const r = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : v ?? null), P = (q) => (q ? { x: r(q.x), y: r(q.y) } : null);
  seatLog.push({ seat: game.user?.id ?? "", key: w.key ?? `${w.seed}|${w.role}`, text: w.text, role: w.role, space: call.space ?? "world", seed: w.seed,
    ts: Math.round(w.ts ?? toShared(w.t)), size: r(call.table?.size), at: P(call.table?.at), drawn: r(call.o?.size), seatAt: P(call.o?.at),
    rule: call.fit?.rule ?? "ok", rules: call.fit?.rules ?? [], k: r(call.fit?.k ?? 1), cap: r(call.fit?.cap), clean: call.fit?.clean ?? null,
    box: call.box ? [r(call.box.x0), r(call.box.y0), r(call.box.x1), r(call.box.y1)] : null, played: Math.round(toShared(performance.now())) });
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
    if ( w.obj && !C.fireEventLive({ obj: w.obj, voice: w.voice }, Fire.allStrokes?.()?.get(w.obj), sharedNow()) ) { stats.stale++; return; }
    let h, call = null;
    try {
      if ( w.stream ) h = playStream(w);
      else { call = seatCall(w); if ( !call.o ) { seatSkip(w, "off"); return; } h = L.play(w.text, call.o); }
    } catch ( err ) { console.warn(`${MODULE_ID} | sfx: a word did not play`, err); return; }
    if ( !h ) return;
    stats.words++;
    if ( call ) logCall(w, call);
    // (a travelling PRE word - a bomb's fall, a rocket's flight - is gone before the main word's flash frame: SPEC-EFFECTS 4.4)
    if ( Number.isFinite(w.stopAt) ) { const g1 = gen; setTimeout(() => { if ( g1 === gen ) { try { h.stop(); } catch {} } }, Math.max(0, w.stopAt - performance.now())); }
    // (EFFECTS2: a cave-in's word sinks as it holds, so what it covers reaches half its height lower; REQUESTS EFFECTS2-4)
    const b0 = call?.box ?? w.box, bx = b0 && w.voice === "cavein" ? { ...b0, y1: b0.y1 + (b0.y1 - b0.y0) * 0.5 } : b0;
    const rec = { box: bx, h, obj: w.obj, voice: w.voice };
    alive.add(rec);
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
  const beats = C.streamBeats(W);
  const at = () => {
    const ms = performance.now() - t0;
    let i = 1; while ( i < W.length - 1 && W[i].ms < ms ) i++;
    const a = W[i - 1], b = W[i] ?? a, f = b.ms > a.ms ? Math.min(1, Math.max(0, (ms - a.ms) / (b.ms - a.ms))) : 1;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  };
  const { material } = C.wordOpts({ voice: w.voice, kind: w.kind, loud: w.loud, emat: w.emat, mat: w.mat, lang: lang() });
  return L.stream({ kind: w.kind, ...(material ? { material } : {}), lang: lang(), space: "world", at, dir: Number.isFinite(w.stream.dir) ? w.stream.dir : -90, beats, startAt: t0, area: w.area, magnitude: w.magnitude, seed: w.seed,
    ...(w.colors ? { colors: w.colors } : {}), loud: (i) => 0.7 + 0.3 * Math.sin(i * 1.7), reduced: reducedMotion(), ...layerOpts(),
    ...streamStep(grpOf(w), { space: "world", area: w.area, magnitude: w.magnitude }) });
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
  burns.clear(); ledger.clear(); pageWaits.clear(); holdMemo.clear();
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
    burns.clear();
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
  status: () => ({ mode: mode(), lang: lang(), sizes: Object.fromEntries(SZ.SIZE_GROUPS.map((g) => [g, stepFor(g)])), engine: L?.version ?? null, alive: alive.size, waiting: sched.size, gated: gated.size, pages: pages.size, ...stats }),
  /** The pages of the scene's preset firings (EFFECTS1): their words (role, kind, moment, rank) and what they keep silent. */
  pages: () => [...pages.values()].map((p) => ({ fid: p.rec.id, preset: p.rec.preset, main: p.pg.main, ground: p.ground, words: p.pg.words.map((w) => ({ key: w.key, role: w.role, kind: w.kind, t: w.t, rank: w.rank })),
    owned: { d: p.pg.owned.d.size, f: p.pg.owned.f.size, catch: p.pg.owned.catch.size, out: p.pg.owned.out.size } })),
  /** Plan (no play) the words of events [{ voice, x, y, r, t?, key? }] here and now: for checks and the docs. */
  plan: (events) => C.cluster(events.map((e, i) => ({ key: `p${i}`, t: performance.now(), ...e })), grid())
    .flatMap((g) => C.planCluster(g, { grid: grid(), sec: (C.CAPS[perfMode()] ?? C.CAPS.high).sec, seed: canvas.scene?.id ?? "", known })),
  /** Play events now (scene px): `api.sfx.test([{ voice: "crash", x, y, r: 300 }])`. */
  test: (events) => { const t = performance.now() + 30; for ( const [i, e] of events.entries() ) add({ key: `test|${Date.now()}|${i}`, t, ...e }); },
  /** The interface panels this client keeps words off (client px), and the fire sounds burning. */
  ui: () => uiCache.rects, placed: () => lastPlaced.slice(), burns: () => [...burns.entries()].map(([k, b]) => ({ key: k, live: b.live, n: b.subs.length, idx: b.idx })),
  /** MAPSFXSEAT: this seat's log of every lettering call (the table's word - text, seed, size, place, shared moment - and the seat rule it
      was drawn by); `clear` empties it. The table picture's words (the ledger: key, box, life on the shared clock). */
  log: ({ clear = false } = {}) => { const l = seatLog.slice(); if ( clear ) seatLog = []; return l; },
  table: () => ledger.list.map((q) => ({ ...q })),
  core: C
};

/** SFXSIZE: a seat that may not change the world's settings (a player) does not see them in Foundry's settings window; the lettering
    sizes are shown to it read-only, as text under this module's own lettering row: the GM chooses them for the table. */
function sizeRowsForPlayer(app, html) {
  try {
    if ( game.user?.can?.("SETTINGS_MODIFY") ) return;
    const root = html instanceof HTMLElement ? html : html?.[0] ?? app?.element;
    const row = root?.querySelector?.(`[name="${MODULE_ID}.sfxLetters"]`)?.closest(".form-group");
    if ( !row || row.parentElement?.querySelector(".moinen-sfx-sizes") ) return;
    const T = (k) => game.i18n.localize(`MOINENMAPS.Sfx.${k}`);
    const box = document.createElement("div");
    box.className = "moinen-sfx-sizes";
    for ( const g of SZ.SIZE_GROUPS ) {
      const st = stepFor(g), r = document.createElement("div");
      r.className = "form-group";
      r.dataset.sfxSize = g;
      const lab = document.createElement("label"); lab.textContent = T(`size.${g}`);
      const f = document.createElement("div"); f.className = "form-fields";
      const out = document.createElement("output"); out.textContent = `${st} · ${T(`size.step${st}`)}`;
      f.append(out); r.append(lab, f); box.append(r);
    }
    const hint = document.createElement("p"); hint.className = "hint"; hint.textContent = T("size.gmOnly");
    box.append(hint);
    row.after(box);
  } catch ( err ) { console.warn(`${MODULE_ID} | sfx: the lettering sizes could not be shown`, err); }
}

export function registerSfx() {
  moduleApi.sfx = sfxApi;
  Hooks.once("init", registerSettings);
  Hooks.once("ready", () => {
    refresh(); const m = game.modules.get(MODULE_ID); if ( m?.api ) m.api.sfx ??= sfxApi;
    // the world's word set is fixed once, by the active GM's language (then every seat letters the same words)
    if ( game.user?.isActiveGM && get("sfxWordsWorld", "auto") === "auto" ) game.settings.set(MODULE_ID, "sfxWordsWorld", C.langOf("auto", game.i18n?.lang)).catch(() => {});
  });
  // (canvasTearDown cleared the old scene; at canvasReady the new scene's fire may already have shown its flames: kept)
  Hooks.on("canvasReady", () => { teardown(false); refresh(); });
  Hooks.on("canvasTearDown", () => teardown(true));
  Hooks.on("renderSettingsConfig", (app, html) => sizeRowsForPlayer(app, html));
  Hooks.on("moinenMapsPresets", (kind, data) => { if ( kind === "firing" ) onFiring(data?.rec); });
  Hooks.on("moinenMapsFire", (kind) => { if ( kind === "edited" || kind === "loaded" ) { if ( kind === "loaded" ) { fireSeen = new Map(); onFire(true); } else onFire(false); } });
}
