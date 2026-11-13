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

const MAX_AHEAD = 120000;      // events further ahead than this (a preset timed minutes ahead) are not scheduled
const BURN_AFTER = 1500;       // ms after a fire shows before its continuous sound starts (the catch word has the stage first)
const UI_MS = 400;
const DRIFT = [0.15, 0.9];      // steam's way up off what was put out (grid squares: sideways, up)             // the interface rectangles are measured at most this often

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
  if ( due > 30 ) { later(e.key, due, () => queue(e), { obj: e.obj, voice: e.voice }); return; }
  queue(e);
}
function queue(e) {
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
  add(C.entryEvent(I, o, ap, start, { speed, gun: walk, ride, shot, key: `d|${g.hash}|${Math.round(start)}`, sid: `d|${g.hash}`, objId: g.objId ? `d${g.objId}` : null,
    from: p0 ? { x: o.x + p0[0] * ap, y: o.y + p0[1] * ap } : null }));
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
  const G = grid(), flight = (L) => Math.min(A.BULLET_MAX, Math.max(A.BULLET_MIN, (L / G) / A.BULLET_SQ * 1000));
  const t0 = toPerf(Number(rec.t0) || sharedNow());
  (rec.pending?.accent ?? []).forEach((it, i) => {
    if ( it?.kind !== "muzzle" || !Array.isArray(it.from) || !it.hits?.length ) return;
    const last = Math.max(...it.hits.map((h) => h[2] || 0));
    shooters.push({ pts: it.hits.map((h) => [h[0], h[1]]), t1: t0 + last + 6000 });
    const e = C.muzzleEvent(it, { t0, grid: G, muzzleOf: A.muzzleOf, flight, key: `m|${rec.id}|${i}`, sid: `m|${rec.id}|${i}` });
    if ( e ) add(e);
  });
}

/** Fire: the layer's strokes changed (or the scene opened): the events of what is new or changed. */
function onFire(first = false) {
  if ( !canvas?.scene ) return;
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
    for ( const p of plans ) {
      const inView = p.points.some((q) => q.x > v.x0 - G && q.x < v.x1 + G && q.y > v.y0 - G && q.y < v.y1 + G);
      const isLive = p.live && inView && live < caps.live;
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
    const v = view(), ui = uiBoxes(), em = burnSize(p, live) * 1.25 * (L?.prefs?.scale ?? 1);
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
        ...(p.colors ? { colors: p.colors } : {}), glow: "auto", reduced: red, ...(live ? {} : { mode: "ambient" }), ...layerOpts() });
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
  for ( const g of groups ) {
    // (an echo of a sound just played - a bomb's crater after its fireball - is part of it)
    if ( C.isEcho(g, recent, G) ) { stats.echoes = (stats.echoes ?? 0) + 1; continue; }
    const specs = C.planCluster(g, { grid: G, sec: caps.sec, seed, big, known });
    for ( const w of specs ) if ( w.role === "main" ) w.obj = g.main.obj;
    // the engine writes each word (its vocabulary: the kind, how loud, how long; seeded, the same on every client); the words of one
    // moment differ from each other (avoid), nothing else of this client's history changes them
    const taken = [];
    for ( const w of specs ) { write(w, taken); measure(w); }
    const room = caps.alive - alive.size;
    const placed = C.capWords(C.place(specs.filter((w) => w.text || w.stream), { view: v, ui, tokens, alive: [...alive].map((a) => a.box) }), room);
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
    const word = L.word(w.kind, o);
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
    ...(w.from ? { from: w.from } : {}), ...(w.colors ? { colors: w.colors } : {}), ...layerOpts() };
  for ( const k of ["in", "holdKind", "out", "on", "push", "glow"] ) if ( st[k] !== undefined ) o[k] = st[k];
  // the word lasts as long as its sound (a fire going out hisses while its flames die; a crack is a snap)
  if ( w.ms >= 900 ) o.hold = Math.round(Math.min(4500, Math.max(600, w.ms * 0.7)));
  // steam drifts up off what was put out
  if ( w.drift && !red ) o.path = { from: { x: w.x, y: w.y }, to: { x: w.x + G * DRIFT[0], y: w.y - G * DRIFT[1] }, duration: Math.round(w.ms * 1.1), ease: "out", orient: "none" };
  // a thing that travels: its word rides along with it
  if ( w.path && !red ) { o.path = { points: w.path.map((q) => ({ x: q.x, y: q.y })), duration: Math.max(400, w.path.at(-1).ms), ease: "linear", orient: "lean", smooth: "line" }; o.hold = Math.max(o.hold ?? 0, Math.round(w.path.at(-1).ms)); }
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
    const rec = { box: w.box, h, obj: w.obj, voice: w.voice };
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
  return L.stream({ kind: w.kind, lang: lang(), space: "world", at, dir: Number.isFinite(w.stream.dir) ? w.stream.dir : -90, beats, startAt: t0, area: w.area, magnitude: w.magnitude, seed: w.seed,
    ...(w.colors ? { colors: w.colors } : {}), loud: (i) => 0.7 + 0.3 * Math.sin(i * 1.7), reduced: reducedMotion(), ...layerOpts() });
}

/* ---------------------------------------------------------------- lifecycle */

function teardown(full = true) {
  gen++;
  clearTimeout(gatherTimer); gatherTimer = 0; pending = [];
  for ( const s of sched.values() ) clearTimeout(s.id);
  sched.clear(); gated.clear(); if ( full ) shownAt.clear(); alive.clear(); seenEntry.clear(); fireSeen = new Map(); recent = []; shooters = [];
  clearTimeout(burnTimer); burnTimer = 0;
  for ( const b of burns.values() ) for ( const s of b.subs ) { try { s.stop({ quick: true }); } catch {} }
  burns.clear();
  uiCache = { t: -1e9, rects: [], boxes: [] };
}
function refresh() {
  sfxBus.entry = mode() === "off" ? null : onEntry;
  sfxBus.fireShown = mode() === "off" ? null : onFireShown;
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
  }
}

export const sfxApi = {
  /** How it stands: events seen, clusters, words played / dropped / late / stale, planning ms, interface ms, burning sounds, words alive. */
  status: () => ({ mode: mode(), lang: lang(), engine: L?.version ?? null, alive: alive.size, waiting: sched.size, gated: gated.size, ...stats }),
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
