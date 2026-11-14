/* LMAP / FXLM: COMIC SOUND EFFECTS of the map's destruction and fire, the runtime. What sounds (sfx-core.mjs plans it):
     - a damage area entering (destruction display.enter, through sfx/bus.mjs): every client plays the same entry (the scene flag's
       entries, a preset's shared clock, a cinematic show, a Detonate), so every client letters it too;
     - the fire layer's strokes (fire.mjs; the same strokes and the same shared clock on every client): a fire catching (when its
       flames SHOW on this client: fire.mjs tells the bus), flaring up, going out, an explosion, ground dust, an eraser dousing fire;
     - a burning fire's CONTINUOUS sound for as long as it burns: the engine's sustain (a phrase score; a smoulder: its quiet ambient
       mode), riding the flame front while it runs along its path, its level following the fire's level.
   Nothing is networked: the same events with the same seeds (the scene id + the event's key) give the same words everywhere; no
   per-client memory changes a word (FXLM 14).
   Words come from the engine's own vocabulary (L.word: the kind, loudness and duration of the sound), its look follows the sound, its
   motion the staging asked by sfx-core (a cave-in drops, a bomb shoves the words around it aside, a car's word rides with the car).
   Placement on THIS client's screen: beside what it letters, off tokens, off this client's interface panels, off other words.
   Settings: "sfxLetters" (client: all / big only / off), "sfxLettersWorld" (the GM's switch for everyone), "sfxWords" (client: the
   word set, auto = the game's language), "sfxLayer". Reduced motion: the module's own rule (config.reducedMotion), passed on. */
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
import { buildTimeline } from "../tokens/carry-core.mjs";
import { hitsOf } from "../tokens/plough-core.mjs";

const MAX_AHEAD = 120000;      // events further ahead than this (a preset timed minutes ahead) are not scheduled
const BURN_AFTER = 1500;       // ms after a fire shows before its continuous sound starts (the catch word has the stage first)
const UI_MS = 400;             // the interface rectangles are measured at most this often
const DRIFT = [0.15, 0.9];     // steam's way up off what was put out (grid squares: sideways, up)
// a live fire's lasting word: the engine's sustain treatments WITHOUT "echo" (EFFECTS1, live: the echo copies sat stacked on
// the word itself, FOOOFF three times over one fire)
const BURN_TREATMENTS = ["breath", "stretch", "split", "shed", "accent"];

let L = null, loading = null, gen = 0;      // gen: the scene's generation (a scene change makes every waiting callback stale)
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
let farCount = { key: "", k: 0, n: 0, list: new Map() };
const stats = { events: 0, clusters: 0, words: 0, dropped: 0, late: 0, stale: 0, ms: 0, uiMs: 0, burns: 0 };

/* ---------------------------------------------------------------- settings */

const get = (k, d) => { try { return game.settings.get(MODULE_ID, k); } catch { return d; } };
export const mode = () => (get("sfxLettersWorld", true) === false ? "off" : get("sfxLetters", "all"));
// (every seat must see the same word for the same moment: "auto" follows the WORLD's word set, which the GM's language sets once)
const lang = () => { const c = get("sfxWords", "auto"); return C.langOf(c !== "auto" ? c : get("sfxWordsWorld", "auto"), game.i18n?.lang); };

function registerSettings() {
  const T = (k) => `MOINENMAPS.Sfx.${k}`;
  game.settings.register(MODULE_ID, "sfxLetters", { name: T("set"), hint: T("setHint"), scope: "client", config: true, type: String, default: "all",
    choices: { all: T("all"), big: T("big"), off: T("off") }, onChange: () => refresh() });
  game.settings.register(MODULE_ID, "sfxLettersWorld", { name: T("world"), hint: T("worldHint"), scope: "world", config: true, restricted: true, type: Boolean, default: true, onChange: () => refresh() });
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
  loading ??= letters().then((e) => {
    L = e; try { known = new Set((L.vocab?.list?.("en") ?? []).map((k) => k.id)); } catch { known = null; }
    if ( pending.length && !gatherTimer ) gatherTimer = setTimeout(flush, 0);
    scheduleBurn(0);
    return e;
  }).catch((err) => { console.warn(`${MODULE_ID} | sfx: the lettering engine did not load`, err); loading = null; return null; });
  return null;
}

/* ---------------------------------------------------------------- events in */

const grid = () => canvas?.grid?.size || 100;
/** a shared-clock moment -> this page's performance clock */
const toPerf = (t) => performance.now() + (t - sharedNow());
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
  if ( isOwned(e) ) { stats.owned = (stats.owned ?? 0) + 1; return; }
  if ( seenEvent.has(e.key) ) return;
  seenEvent.add(e.key);
  if ( seenEvent.size > 4000 ) { const it = seenEvent.values(); for ( let i = 0; i < 1000; i++ ) seenEvent.delete(it.next().value); }
  stats.events++;
  // a fire's catch waits until its flames show here (the field is computed in a worker: a big fire shows a second or two later)
  if ( e.gate ) {
    const at = shownAt.get(e.gate);
    if ( at === undefined ) { const l = gated.get(e.gate) ?? []; l.push({ ...e, waitFrom: performance.now() }); gated.set(e.gate, l);
      later(`gate|${e.key}`, C.GATE_MAX_MS, () => { const l2 = gated.get(e.gate); if ( l2 ) gated.set(e.gate, l2.filter((q) => q.key !== e.key)); }, { obj: e.obj, voice: e.voice }); return; }
    e = { ...e, t: Math.max(e.t, at + 120) };
  }
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
    const l = gated.get(id); gated.delete(id);
    for ( const e of l ?? [] ) { seenEvent.delete(e.key); stats.events--; const k = sched.get(`gate|${e.key}`); if ( k ) { clearTimeout(k.id); sched.delete(`gate|${e.key}`); } add({ ...e, gate: e.gate }); }
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
  if ( g.objId && owned.d.has(g.objId) ) { for ( const p of pages.values() ) if ( p.pg.owned.d.has(g.objId) && !p.ground ) p.ground = C.matOf(I.mat); return; }
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
function storyPage(id, t0, words, ground = null) {
  const p = { rec: { id, t0, size: 1 }, pg: { words }, ground };
  for ( const w of words ) {
    const t = toPerf(w.t), lead = 140;
    if ( t + Math.max(C.LATE_MS, (w.ms ?? 0) * 0.6) < performance.now() ) continue;
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
  if ( mode() === "off" || !canvas?.ready || !d?.order?.length ) return;
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
  const comp = EV.detonateComposition(evs, { grid: grid(), max: EV.DETONATE_MAX[perfMode()] ?? 3, prio: (v) => C.VOICES[v]?.prio ?? 0 });
  stats.detonates = (stats.detonates ?? 0) + 1;
  for ( const e of comp ) add(e);
}
/** The rain's lightning shown here (weather api.stormDisplay: only while this client shows the storm): its flashes ahead, lettered. */
function pollStorm() {
  clearTimeout(stormTimer); stormTimer = 0;
  const g0 = gen;
  const again = (ms) => { stormTimer = setTimeout(() => { if ( g0 === gen ) pollStorm(); }, ms); };
  if ( mode() === "off" || !canvas?.ready ) return again(2000);
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
    storyPage(`flash|${id}`, ev.t, [{ ...w, key: w.role, ...(w.screen ? {} : { box: { x0: w.x - r, y0: w.y - r * 0.4, x1: w.x + r, y1: w.y + r * 0.4 }, side: C.h01(`${w.seed}|s`) < 0.5 ? -1 : 1 }) }]);
    stats.flashes = (stats.flashes ?? 0) + 1;
  }
  again(700);
}
/** How many far flashes the storm made before slot `k` since it was switched on (counted once, then kept up: the same on every client). */
function farBefore(storm, k) {
  const S = storm.S, SM = moduleApi.weather?.stormModel; if ( !S || !SM?.flashOf ) return 1;
  const key = `${S.t}|${storm.seed}|${S.rate}|${S.near}|${S.on}`;
  if ( farCount.key !== key ) farCount = { key, k: Math.max(Math.floor(S.t / SM.SLOT), k - EV.FAR_SCAN), n: 0, list: new Map() };
  if ( farCount.list.has(k) ) return farCount.list.get(k);
  if ( k < farCount.k ) return C.hashStr(String(k)) & 1;
  for ( ; farCount.k < k; farCount.k++ ) { const ev = SM.flashOf(S, storm.seed, farCount.k, storm.rainP); if ( ev?.kind === "far" ) { farCount.list.set(farCount.k, farCount.n); farCount.n++; } }
  farCount.list.set(k, farCount.n);
  if ( farCount.list.size > 2000 ) farCount.list.delete(farCount.list.keys().next().value);
  return farCount.n;
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
/** The page of a firing: planned once its fire-layer strokes are here (they come in the same scene update, maybe a moment later). */
function planPage(rec, tries = 0) {
  if ( !rec?.id || pages.has(rec.id) ) return;
  const all = Fire.allStrokes?.() ?? new Map();
  const missing = (rec.f ?? []).some((e) => !all.has(e.id));
  if ( missing && tries < 12 ) { const g0 = gen; setTimeout(() => { if ( g0 === gen ) planPage(rec, tries + 1); }, 80); return; }
  let pg;
  try { pg = PG.firingPage(rec, { grid: grid(), strokes: all, wayOf: MC.wayOf, headAt: MC.headAt, fallAt: landingFallAt, lift: 0.5 }); }
  catch ( err ) { console.warn(`${MODULE_ID} | sfx: a firing's page failed`, err); return; }
  const p = { rec, pg, ground: null };
  pages.set(rec.id, p);
  for ( const id of pg.owned.d ) owned.d.add(id);
  for ( const id of pg.owned.f ) owned.f.add(id);
  for ( const id of pg.owned.catch ) owned.catch.add(id);
  for ( const [id, o] of pg.owned.out ) owned.out.set(id, o);
  // (what the fire layer already queued for these strokes before the page came: dropped)
  pending = pending.filter((e) => !isOwned(e));
  for ( const [k, s] of sched ) if ( s.ev && isOwned(s.ev) ) { clearTimeout(s.id); sched.delete(k); }
  if ( mode() === "off" ) return;
  for ( const w of pg.words ) {
    const t = toPerf(w.t), lead = 140;
    if ( t + Math.max(C.LATE_MS, (w.ms ?? 0) * 0.6) < performance.now() ) continue;      // (a late joiner: its moment is over)
    later(`pg|${rec.id}|${w.key}`, t - lead - performance.now(), () => pageWord(p, w, t));
  }
}
/** One word of a page, at its moment: written (its ground resolved now), placed on this client's screen, played. */
function pageWord(p, w, t, waited = 0) {
  if ( mode() === "off" || !canvas?.ready ) return;
  if ( !L ) { engine(); return; }
  if ( mode() === "big" && w.role !== "main" ) return;
  // a catch waits for its flames to show here
  if ( w.gate && !shownAt.has(w.gate) ) {
    if ( waited < C.GATE_MAX_MS ) { const g0 = gen; setTimeout(() => { if ( g0 === gen ) pageWord(p, w, Math.max(t, performance.now() + 120), waited + 150); }, 150); }
    return;
  }
  const caps = C.CAPS[perfMode()] ?? C.CAPS.high;
  if ( w.role !== "main" && alive.size >= caps.alive ) { stats.dropped++; return; }
  // a landing or a fire this client can see (its own, else the nearest in time in view): the debris and the catch are lettered where
  // this screen shows them
  const G = grid(), lg = lang(), sd = `${canvas.scene?.id ?? ""}|${w.seed}`;
  const wo = { ...w.wo, material: PG.materialFor(w.wo, p.ground) };
  if ( wo.material == null ) delete wo.material;
  // the word is written BEFORE this screen picks its spot (so every client writes the same words in the same order, whatever it
  // drops), and never repeats a word of its own page: one bomb's debris words were seen saying the same thing twice (EFFECTS1)
  p.texts ??= new Set(); p.wt ??= new Map();
  let word = p.wt.get(w.key);
  if ( !word ) {
    try {
      word = PG.unrepeated((s) => L.word(w.kind, { ...wo, seed: s, lang: lg }), sd, p.texts);
    } catch ( err ) { console.warn(`${MODULE_ID} | sfx: no word for ${w.kind}`, err); return; }
    p.texts.add(word.text); p.wt.set(w.key, word);
  }
  let alts = [], spot0 = null;
  const w0 = w;
  if ( w.cands ) {
    p.used ??= new Set();
    const ss = PG.pickSpots(w, view(), p.used, Number(p.rec.t0), 6), s = ss[0];
    if ( !s ) { stats.dropped++; return; }
    alts = ss.slice(1);
    p.used.add(spot0 = `${Math.round(s.x)},${Math.round(s.y)}`);
    w = { ...w, x: s.x, y: s.y, ...(s.gate ? { gate: s.gate } : {}) };
  }
  if ( !word?.text ) return;
  const role = w.role === "main" ? "main" : w.role === "pre" ? "pre" : "sec";
  const r = w.r ?? G * 0.4;
  const spec = { role, voice: w.kind, kind: w.kind, word, text: word.text, chars: [...word.text].length, x: w.x, y: w.y, t, ms: w.ms ?? 700, seed: sd,
    // (EFFECTS2: a story's words are sized by rank as a share of this client's view: readable at any zoom, a lower rank never bigger)
    rank: w.rank, shrink: w.shrink ?? 1,
    magnitude: PG.pageMag(w, p.rec.size), area: Math.round(Math.max(G * 0.15, Math.min(r, G * 3))), rotation: (C.h01(w.seed + "|rot") - 0.5) * 10, stage: w.stage ?? {},
    cover: w.role === "main" ? 0.3 : 0.25, subject: w.box ?? { x0: w.x - r, y0: w.y - r, x1: w.x + r, y1: w.y + r }, drift: !!w.drift, ...(w.from ? { from: w.from } : {}),
    ...(w.role === "main" && w.side ? { around: C.besideOf(w.side) } : {}), ...(w.ride ? { path: w.ride } : {}) };
  measure(spec);
  // (a ride from beyond the screen's edge comes in AT the edge, whole; one going past it - the plough's grind - stops at it)
  if ( w.ride && spec.path ) {
    spec.path = PG.rideInView(spec.path, view(), spec.bw ?? 0, spec.bh ?? 0);
    if ( spec.path[0] ) { spec.x = spec.path[0].x; spec.y = spec.path[0].y; }
  }
  // a travelling PRE word leaves (its exit, about a fifth of a second) so it is gone PRE_GAP before the main word's frame
  if ( w.role === "pre" && w.ride ) {
    const mw = p.pg.words.find((q) => q.role === "main");
    if ( mw ) spec.stopAt = toPerf(mw.t) - PG.PRE_GAP - 220;
    // (a ride that hands over to the next one - the meteor's far whine to its roar - leaves when its own way ends)
    if ( p.pg.words.some((q) => q !== w && q.role === "pre" && q.ride && q.t > w.t) ) spec.stopAt = Math.min(spec.stopAt ?? Infinity, t + (w.ms ?? 0) + 60);
  } else if ( w.role === "pre" ) {
    // (EFFECTS2: a standing PRE word - the meteor's rumble - yields when the main word lands: live it stood under the blast for a second
    // and a half and crowded the wave and the first debris)
    const mw = p.pg.words.find((q) => q.role === "main");
    if ( mw ) spec.stopAt = toPerf(mw.t) + 40;
  }
  // the wave rides out the free way on this screen: away from the main word as placed here, off the panels, inside the view
  if ( w.wave ) {
    const v = view(), wr = PG.waveRide(w.wave.at, w.wave.r0, w.wave.reach, w.wave.rim, { avoid: [...(p.mainBox ? [p.mainBox] : []), ...[...alive].map((a) => a.box).filter(Boolean)],
      ui: uiBoxes(), v, wb: { w: spec.bw ?? G, h: spec.bh ?? G * 0.4 } });
    spec.path = wr.ride; spec.x = wr.ride[0].x; spec.y = wr.ride[0].y;
    // (a pressure front: the word travels upright - leaning along a downward way it read as a fallen column - and is gone soon after
    // the front breaks up, live it stood at the reach for two seconds and took the debris words' places)
    spec.orient = "none"; spec.stopAt = t + w.wave.rim + 180;
  }
  // (owner's answer 4: a sound whose source this player cannot see - under the fog, out of vision - is shown generally on the
  // screen, never at the hidden place)
  if ( w.screen ) { playScreen(spec, w.screen); return; }
  if ( !hereVisible(w.at?.x ?? w.x, w.at?.y ?? w.y) ) { playScreen(spec); return; }
  let placed = C.place([spec], { view: view(), ui: uiBoxes(), tokens: tokenBoxes(view()), alive: [...alive].map((a) => a.box) });
  // (a debris / catch word covered by the story's bigger words still on screen takes the next landing in view instead of being dropped)
  for ( const s of alts ) {
    if ( placed.length ) break;
    const r2 = w.r ?? G * 0.4;
    const s2 = { ...spec, x: s.x, y: s.y, subject: { x0: s.x - r2, y0: s.y - r2, x1: s.x + r2, y1: s.y + r2 } };
    placed = C.place([s2], { view: view(), ui: uiBoxes(), tokens: tokenBoxes(view()), alive: [...alive].map((a) => a.box) });
    if ( placed.length ) p.used.add(`${Math.round(s.x)},${Math.round(s.y)}`);
  }
  // (still covered - a meteor's main word and wave fill the crater's surroundings at a close zoom: live, four debris words dropped) -
  // it waits a moment for the bigger words to clear and tries again: the debris keeps coming down, the story still resolves
  if ( !placed.length && w0.cands && waited < PG.FALL_WAIT_MS ) {
    p.used.delete(spot0);
    const g0 = gen; setTimeout(() => { if ( g0 === gen ) pageWord(p, w0, performance.now() + 60, waited + 250); }, 250);
    return;
  }
  if ( !placed.length ) {
    stats.dropped++;
    // (why: the penalties of its least bad place, for checks)
    const why = C.place([{ ...spec, role: "main" }], { view: view(), ui: uiBoxes(), tokens: tokenBoxes(view()), alive: [...alive].map((a) => a.box) })[0]?.pen;
    lastPlaced.push({ text: spec.text, role: spec.role, key: w.key, dropped: true, why: why && { ui: +why.pui.toFixed(2), tok: +why.tok.toFixed(2), wrd: +why.wrd.toFixed(2), off: +why.off.toFixed(2) } });
  }
  if ( w.role === "main" && placed[0] ) p.mainBox = placed[0].box;
  for ( const q of placed ) { play(q); lastPlaced.push({ text: q.text, role: q.role, voice: q.voice, page: p.rec.id, key: w.key, box: q.box }); }
  if ( lastPlaced.length > 24 ) lastPlaced = lastPlaced.slice(-24);
}
/** Can this client see the scene point (x, y)? The GM always; a player under the fog of war or out of vision does not. */
function hereVisible(x, y) {
  if ( game.user?.isGM || !canvas?.visibility?.tokenVision ) return true;
  try { return !!canvas.visibility.testVisibility({ x, y }, { tolerance: grid() * 0.5 }); } catch { return true; }
}
/** A spot on this client's screen free of its panels (client px) for a word `bw` x `bh` client px, the upper middle first: an
    unlocated sound (its source hidden or unknown) is shown there. */
function screenSpot(bw, bh, key = "") {
  uiBoxes();
  const ui = uiCache.rects ?? [], W = innerWidth, H = innerHeight;
  const F = [[0.5, 0.2], [0.36, 0.24], [0.64, 0.24], [0.5, 0.32], [0.28, 0.4], [0.72, 0.4], [0.5, 0.7]];
  const k = Math.floor(C.h01(key) * 3), order = [...F.slice(k), ...F.slice(0, k)];
  let best = null;
  for ( const [fx, fy] of order ) {
    const x = fx * W, y = fy * H, b = { x0: x - bw / 2, y0: y - bh / 2, x1: x + bw / 2, y1: y + bh / 2 };
    const hit = ui.reduce((s, u) => s + Math.max(0, Math.min(b.x1, u.x1) - Math.max(b.x0, u.x0)) * Math.max(0, Math.min(b.y1, u.y1) - Math.max(b.y0, u.y0)), 0);
    if ( !best || hit < best.hit ) best = { x, y, hit };
    if ( !hit ) break;
  }
  return { x: best.x, y: best.y };
}
/** Play a word unlocated (EFFECTS1, owner's answers 2 and 4; engine request KINDS1-1 for a real "screen" placement): in screen space
    over the map (under the bars), not riding, not pointing at anything. */
function playScreen(spec, fixed = null) {
  const zoom = canvas.stage?.scale?.x || 1;
  // (a fixed spot - thunder from beyond an edge - holds the WHOLE word: live, a close strike's big word stood half off the top)
  const fw = (spec.bw ?? 200) * zoom * 0.5 + 16, fh = (spec.bh ?? 80) * zoom * 0.75 + 16;
  const at = fixed ? { x: Math.min(Math.max(fixed.fx * innerWidth, fw), Math.max(fw, innerWidth - fw)), y: Math.min(Math.max(fixed.fy * innerHeight, fh), Math.max(fh, innerHeight - fh)) } : screenSpot((spec.bw ?? 200) * zoom, (spec.bh ?? 80) * zoom, spec.seed);
  const o = optsOf(spec);
  delete o.path; delete o.from; delete o.area;
  Object.assign(o, { space: "screen", layer: "hud", at });
  // (a ranked word on the screen: its share of the screen height in CSS px)
  if ( Number.isFinite(spec.rank) ) Object.assign(o, { size: EV.rankSize(spec.rank, innerHeight, spec.shrink ?? 1), fit: "screen" });
  const g0 = gen, go = () => {
    if ( g0 !== gen || !L || mode() === "off" ) return;
    if ( C.tooLate(spec, performance.now()) ) { stats.late++; return; }
    try { const h = L.play(spec.text, o); if ( h ) { stats.words++; stats.unlocated = (stats.unlocated ?? 0) + 1; } } catch ( err ) { console.warn(`${MODULE_ID} | sfx: a word did not play`, err); }
  };
  const wait = spec.t - performance.now();
  if ( wait > 4 ) later(`ws|${spec.seed}|${spec.t}`, wait, go); else go();
  lastPlaced.push({ text: spec.text, role: spec.role, voice: spec.voice, screen: at });
}

/** Is the shooter at scene point `from` (radius `fr`) visible to this client? A token there that this client cannot see: no. */
function shooterSeen(from, fr) {
  if ( game.user?.isGM ) return true;
  const G = grid(), t = (canvas.tokens?.placeables ?? []).find((q) => q.center && Math.hypot(q.center.x - from[0], q.center.y - from[1]) < (fr ?? G * 0.5) + G * 0.3);
  if ( t ) return !!t.visible && !t.document?.hidden;
  return hereVisible(from[0], from[1]);
}
/** A gun's REPORT shown unlocated (no source token, or a source this client cannot see): the engine's stream of its gun kind in
    screen space at a free spot of this client's screen, one syllable per round as it leaves (`walk` ms from `t0`, perf clock). */
function screenReport(walk, t0, kinds, key) {
  if ( mode() !== "all" || !walk?.length ) return;
  const go = () => {
    if ( !L ) return;
    const kind = C.kindOf("muzzle", known, null, kinds), at = screenSpot(innerWidth * 0.22, innerHeight * 0.1, key);
    try {
      L.stream({ kind, lang: lang(), space: "screen", layer: "hud", at: () => at, dir: -90, beats: C.streamBeats(walk), startAt: t0, magnitude: 0.6,
        seed: `${canvas.scene?.id ?? ""}|${key}`, loud: (i) => 0.7 + 0.3 * Math.sin(i * 1.7), reduced: reducedMotion() });
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
  const on = mode() === "all" && Fire.shownHere?.() && canvas?.ready;
  if ( on && L?.sustain ) {
    const now = sharedNow(), pn = performance.now(), G = grid(), v = view(), caps = C.CAPS[perfMode()] ?? C.CAPS.high;
    const fires = [...(Fire.allStrokes?.() ?? new Map()).values()].filter((s) => s.k === "fire" && FM.burningAt(s, now) && shownAt.has(s.id) && pn - shownAt.get(s.id) >= BURN_AFTER);
    const geo = Fire.geo(), P = Fire.params0();
    const plans = C.burnGroups(fires, G).map((g) => C.burnPlan(g, { grid: G, catchMs: (st) => FM.catchMs(st, geo, P), levelNow: (s, t) => FM.levelNow(s, Number.isFinite(t) ? t : undefined) }))
      .sort((a, b) => b.prio - a.prio);
    let live = 0;
    const spots = [];
    for ( const p of plans ) {
      const inView = p.points.some((q) => q.x > v.x0 - G && q.x < v.x1 + G && q.y > v.y0 - G && q.y < v.y1 + G);
      const isLive = p.live && inView && live < caps.live;
      // (a smaller fire whose phrases would sit on a bigger one's: heard in the bigger one's phrases, not lettered on top of them)
      const pts = p.points.map((_, i) => p.at(i, now)), em = burnSize(p, isLive) * 1.25 * (L?.prefs?.scale ?? 1);
      if ( C.burnCrowded(pts, spots, em) ) continue;
      spots.push(...pts);
      if ( isLive ) live++;
      want.set(p.key, { plan: p, live: isLive });
    }
  }
  for ( const [k, b] of burns ) {
    const w = want.get(k);
    if ( w && w.live === b.live ) { b.plan = w.plan; b.off = burnOffsets(w.plan, w.live); continue; }
    // gone out / removed: its words play their exits (the fire's last breath before the hiss); switched mode: at once
    for ( const s of b.subs ) { try { s.stop({ quick: !!w }); } catch {} }
    burns.delete(k);
  }
  for ( const [k, w] of want ) if ( !burns.has(k) ) { const b = { plan: w.plan, live: w.live, off: burnOffsets(w.plan, w.live), subs: [] }; burns.set(k, b); b.subs = startBurn(w.plan, w.live); }
  stats.burns = burns.size;
  if ( burns.size || [...(Fire.allStrokes?.() ?? new Map()).values()].some((s) => s.k === "fire") ) scheduleBurn(1000);
}
/** Where each spot's words must move to stay off this client's interface panels (their phrases hover around the spot, in two seats
    one above the other, a little to either side: a box of about nine of their letters wide (an echo trails beside it) and three and a half high, mostly above
    it). Measured once a second with the burn. */
function burnOffsets(p, live) {
  try {
    // (off the panels, and off the event words still up: a debris word that landed where the fire then catches)
    const v = view(), ui = [...uiBoxes(), ...[...alive].map((a) => a.box).filter(Boolean)], em = burnSize(p, live) * 1.25 * (L?.prefs?.scale ?? 1);
    return p.points.map((_, i) => { const q = p.at(i, sharedNow()), inV = q.x > v.x0 && q.x < v.x1 && q.y > v.y0 && q.y < v.y1;
      // (a spot off this screen stays where it is: its words are not pulled into view)
      return inV ? C.clearOf({ x0: q.x - em * 4.4, y0: q.y - em * 2.5, x1: q.x + em * 4.4, y1: q.y + em * 0.9 }, ui, v, Math.max(v.x1 - v.x0, v.y1 - v.y0) * 0.45) : { dx: 0, dy: 0 }; });
  } catch { return []; }
}
/** The cap height (scene px) of a burning fire's words: a share of the screen height at this zoom (live: 3.5..6 %, by the fire's
    level; ambient: 3 %), never more than the engine's own size for it - its phrases sit over the flames for as long as they burn,
    so they stay a size under the event words (the engine's ceiling share, ceilK, does not reach continuous sounds: REQUESTS lmap) */
function burnSize(p, live) {
  const zoom = canvas.stage?.scale?.x || 1, lv = p.level(sharedNow());
  const px = innerHeight * (live ? 0.035 + 0.03 * Math.min(1, lv / 0.9) : 0.03);
  return Math.max(4, px / zoom);
}
function startBurn(p, live) {
  const seed = `${canvas.scene?.id ?? ""}|burn|${p.seedId}`, red = reducedMotion(), G = grid();
  const kind = C.kindOf("fire", known);
  return p.points.map((q, i) => {
    try {
      return L.sustain({ kind, space: "world", at: () => { const b = burns.get(p.key), q = (b?.plan ?? p).at(i, sharedNow()), o = b?.off?.[i];
          return o ? { x: q.x + o.dx, y: q.y + o.dy } : q; },
        level: () => p.level(sharedNow()), seed: `${seed}|${i}`, lang: lang(), area: Math.min(p.r, G * 1.2), dir: -90, size: burnSize(p, live),
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
  const pm = perfMode(), caps = C.CAPS[pm] ?? C.CAPS.high, G = grid(), big = mode() === "big";
  const v = view(), tokens = tokenBoxes(v), ui = uiBoxes();
  const groups = C.cluster(due, G).sort((a, b) => ((C.VOICES[b.main.voice]?.prio ?? 0) - (C.VOICES[a.main.voice]?.prio ?? 0)) || (b.rEq - a.rEq));
  stats.clusters += groups.length;
  const seed = canvas.scene?.id ?? "";
  recent = recent.filter((r) => now - r.t < Math.max(C.ECHO_MS, C.OUT_GAP_MS));
  // (words placed but not started yet - a flush ahead of their moment - count as on screen: `alive` holds a word only once it plays, and
  // live a Detonate's second word, flushed while the first still waited for its moment, was drawn over it)
  soon = soon.filter((q) => q.until > now);
  const thisFlush = soon.map((q) => q.box);
  for ( const g of groups ) {
    // (an echo of a sound just played - a bomb's crater after its fireball - is part of it)
    if ( !g.main.det && C.isEcho(g, recent, G) ) { stats.echoes = (stats.echoes ?? 0) + 1; continue; }
    const specs = C.planCluster(g, { grid: G, sec: caps.sec, seed, big, known });
    for ( const w of specs ) if ( w.role === "main" ) w.obj = g.main.obj;
    // the engine writes each word (its vocabulary: the kind, how loud, how long; seeded, the same on every client); the words of one
    // moment differ from each other (avoid), nothing else of this client's history changes them
    const taken = [];
    for ( const w of specs ) { write(w, taken); measure(w); }
    const room = caps.alive - alive.size;
    // (the words of this flush's earlier clusters count as on screen: they start a beat later, so `alive` does not hold them yet - live,
    // a Detonate's second word was drawn over its first)
    const placed = C.capWords(C.place(specs.filter((w) => w.text || w.stream), { view: v, ui, tokens, alive: [...[...alive].map((a) => a.box), ...thisFlush] }), room);
    for ( const w of placed ) if ( w.box ) {
      const b = w.voice === "cavein" ? { ...w.box, y1: w.box.y1 + (w.box.y1 - w.box.y0) * 0.5 } : w.box;
      thisFlush.push(b); soon.push({ box: b, until: (w.t ?? now) + 60 });
    }
    stats.dropped += specs.length - placed.length;
    for ( const w of placed ) { play(w); lastPlaced.push({ text: w.text ?? w.kind, role: w.role, voice: w.voice, box: w.box, pen: w.pen && { ui: +w.pen.pui.toFixed(3), tok: +w.pen.tok.toFixed(3), wrd: +w.pen.wrd.toFixed(3), off: +w.pen.off.toFixed(3), sub: +w.pen.sub.toFixed(3) } }); }
    if ( lastPlaced.length > 24 ) lastPlaced = lastPlaced.slice(-24);
    const main = placed.find((w) => w.role === "main");
    if ( main ) recent.push({ x: g.x, y: g.y, reach: Math.max(g.span, (main.bh ?? 0) * 2), t: g.t, prio: C.VOICES[g.main.voice]?.prio ?? 0, voice: g.main.voice });
  }
  stats.ms += performance.now() - t0;
}
/** The engine's word for a spec (its vocabulary), different from the other words of the same moment. */
function write(w, taken) {
  if ( w.stream ) return;
  try {
    const o = { seed: w.seed, lang: lang(), loud: w.textLoud ?? w.loud, duration: w.ms, avoid: taken.slice() };
    // (engine 1.7.1 vocabulary: what was hit, the size of the pieces, the fire's stage; a cave-in's own spelling)
    const { kind = w.kind, ...wo } = C.wordOpts({ voice: w.voice, kind: w.kind, loud: o.loud, emat: w.emat, mat: w.mat, lang: o.lang, level: w.level });
    const word = L.word(kind, { ...o, ...wo });
    if ( !word?.text ) return;
    w.word = word; w.text = word.text; w.chars = [...word.text].length;
    taken.push(word.text, word.template);
  } catch ( err ) { console.warn(`${MODULE_ID} | sfx: no word for ${w.kind}`, err); }
}
/** The options a word plays with (and is measured with). */
function optsOf(w) {
  const G = grid(), red = reducedMotion();
  const st = w.stage ?? {};
  const o = { ...(w.word?.play ?? {}), space: "world", at: { x: w.x, y: w.y }, area: w.area, magnitude: w.magnitude, seed: w.seed, rotation: w.rotation, reduced: red,
    ceilK: C.CEIL_K[w.role] ?? C.CEIL_K.sec,
    // (a story's word sized by its rank: the rank is the hierarchy, the engine's ceiling share does not cut it again)
    ...(Number.isFinite(w.rank) ? { size: EV.rankSize(w.rank, innerHeight / (canvas.stage?.scale?.x || 1), w.shrink ?? 1), ceilK: 1 } : {}),
    ...(w.from ? { from: w.from } : {}), ...(w.colors ? { colors: w.colors } : {}), ...layerOpts() };
  for ( const k of ["in", "holdKind", "out", "on", "push", "glow"] ) if ( st[k] !== undefined ) o[k] = st[k];
  // what was hit makes the sound: its material (the engine's look follows it: rock and timber in stone colours, metal in steel); the
  // word's own character stays, only its material changes (a partial character would replace the whole one)
  if ( w.emat && o.character ) o.character = { ...o.character, material: w.emat };
  // the word lasts as long as its sound (a fire going out hisses while its flames die; a crack is a snap)
  if ( w.ms >= 900 ) o.hold = Math.round(Math.min(4500, Math.max(600, w.ms * 0.7)));
  // steam drifts up off what was put out
  if ( w.drift && !red ) o.path = { from: { x: w.x, y: w.y }, to: { x: w.x + G * DRIFT[0], y: w.y - G * DRIFT[1] }, duration: Math.round(w.ms * 1.1), ease: "out", orient: "none" };
  // a thing that travels: its word rides along with it
  if ( w.path && !red ) { o.path = { points: w.path.map((q) => ({ x: q.x, y: q.y })), duration: Math.max(400, w.path.at(-1).ms), ease: "linear", orient: w.orient ?? "lean", smooth: "line" }; o.hold = Math.max(o.hold ?? 0, Math.round(w.path.at(-1).ms)); }
  return o;
}
/** The word's box (scene px) as the engine will draw its hold picture now (its size model + its layout): placement keeps it free. */
function measure(w) {
  if ( !w.text ) return;
  try {
    const o = optsOf(w);
    const z = L.sizeOf(w.text, o);
    const pf = L.planFor?.(w.text, o), hb = pf?.plan?._holdBox, sk = pf?.plan?.sizeK ?? z?.sizeK ?? 1;
    const u = (z?.size ?? G0()) * (L.prefs?.scale ?? 1) * sk;
    w.size = u;
    w.bw = (hb?.w ?? 0.8 * w.chars + 0.6) * u * 1.08 + u * 0.3;
    w.bh = (hb?.h ?? 1.35) * u * 1.12 + u * 0.25;
    if ( w.drift && !reducedMotion() ) { w.rise = grid() * DRIFT[1]; w.riseX = grid() * DRIFT[0]; }
  } catch { /* the estimate stands */ }
}
const G0 = () => grid() * 0.5;

function play(w) {
  const g0 = gen;
  const go = () => {
    if ( g0 !== gen || !L || mode() === "off" || !canvas?.ready ) return;
    if ( C.tooLate(w, performance.now()) ) { stats.late++; return; }
    // a fire's catch / flare word whose fire went out (or was taken back) meanwhile: not lettered (FXLM 4)
    if ( w.obj && !C.fireEventLive({ obj: w.obj, voice: w.voice }, Fire.allStrokes?.()?.get(w.obj), sharedNow()) ) { stats.stale++; return; }
    let h;
    try {
      h = w.stream ? playStream(w) : L.play(w.text, optsOf(w));
    } catch ( err ) { console.warn(`${MODULE_ID} | sfx: a word did not play`, err); return; }
    if ( !h ) return;
    stats.words++;
    // (a travelling PRE word - a bomb's fall, a rocket's flight - is gone before the main word's flash frame: SPEC-EFFECTS 4.4)
    if ( Number.isFinite(w.stopAt) ) { const g1 = gen; setTimeout(() => { if ( g1 === gen ) { try { h.stop(); } catch {} } }, Math.max(0, w.stopAt - performance.now())); }
    // (EFFECTS2: a cave-in's word sinks as it holds - live, the debris word after it was placed just under its box and drawn inside its
    // letters - so what it covers here reaches half its height lower; REQUESTS EFFECTS2-4)
    const bx = w.box && w.voice === "cavein" ? { ...w.box, y1: w.box.y1 + (w.box.y1 - w.box.y0) * 0.5 } : w.box;
    const rec = { box: bx, h, obj: w.obj, voice: w.voice };
    alive.add(rec);
    Promise.resolve(h.finished).finally(() => alive.delete(rec));
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
    ...(w.colors ? { colors: w.colors } : {}), loud: (i) => 0.7 + 0.3 * Math.sin(i * 1.7), reduced: reducedMotion(), ...layerOpts() });
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
  burns.clear();
  uiCache = { t: -1e9, rects: [], boxes: [] };
}
function refresh() {
  sfxBus.entry = mode() === "off" ? null : onEntry;
  sfxBus.fireShown = mode() === "off" ? null : onFireShown;
  sfxBus.detonate = mode() === "off" ? null : onDetonate;
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

export const sfxApi = {
  /** How it stands: events seen, clusters, words played / dropped / late / stale, planning ms, interface ms, burning sounds, words alive. */
  status: () => ({ mode: mode(), lang: lang(), engine: L?.version ?? null, alive: alive.size, waiting: sched.size, gated: gated.size, pages: pages.size, ...stats }),
  /** The pages of the scene's preset firings (EFFECTS1): their words (role, kind, moment, rank) and what they keep silent. */
  pages: () => [...pages.values()].map((p) => ({ fid: p.rec.id, preset: p.rec.preset, main: p.pg.main, ground: p.ground, words: p.pg.words.map((w) => ({ key: w.key, role: w.role, kind: w.kind, t: w.t, rank: w.rank })),
    owned: { d: p.pg.owned.d.size, f: p.pg.owned.f.size, catch: p.pg.owned.catch.size, out: p.pg.owned.out.size } })),
  /** Plan (no play) the words of events [{ voice, x, y, r, t?, key? }] here and now: for checks and the docs. */
  plan: (events) => C.cluster(events.map((e, i) => ({ key: `p${i}`, t: performance.now(), ...e })), grid())
    .flatMap((g) => C.planCluster(g, { grid: grid(), sec: (C.CAPS[perfMode()] ?? C.CAPS.high).sec, seed: canvas.scene?.id ?? "", known })),
  /** Play events now (scene px): `api.sfx.test([{ voice: "crash", x, y, r: 300 }])`. */
  test: (events) => { const t = performance.now() + 30; for ( const [i, e] of events.entries() ) add({ key: `test|${Date.now()}|${i}`, t, ...e }); },
  /** The interface panels this client keeps words off (client px), and the fire sounds burning. */
  ui: () => uiCache.rects, placed: () => lastPlaced.slice(), burns: () => [...burns.entries()].map(([k, b]) => ({ key: k, live: b.live, n: b.subs.length })),
  core: C
};

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
  Hooks.on("moinenMapsPresets", (kind, data) => { if ( kind === "firing" ) onFiring(data?.rec); });
  Hooks.on("moinenMapsFire", (kind) => { if ( kind === "edited" || kind === "loaded" ) { if ( kind === "loaded" ) { fireSeen = new Map(); onFire(true); } else onFire(false); } });
}
