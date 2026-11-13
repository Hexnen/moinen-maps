/* LMAP: COMIC SOUND EFFECTS of the map's destruction and fire, the runtime. What sounds (sfx-core.mjs plans the words):
     - a damage area entering (destruction display.enter, through sfx/bus.mjs): every client plays the same entry at the same moment
       (the scene flag's entries, a preset's shared clock, a cinematic show, a Detonate), so every client letters it too;
     - the fire layer's strokes (fire.mjs; the same strokes and the same shared clock on every client): a fire catching, spreading,
       flaring up, going out, an explosion (burst), ground dust (a shock wave, a heavy thing, a drag, an engine), an eraser dousing
       fire, and now and then the crackle of what burns.
   Nothing is networked: the same events with the same seeds (the scene id + the event's key) give the same lettering everywhere.
   Events of one moment are gathered for a few frames and clustered (one sound, one main word and a few satellites), then laid out
   readable on this client's screen and played in world space through the shared lettering engine (scripts/letters/, LETR).
   Settings: "sfxLetters" (client: all / big only / off), "sfxLettersWorld" (the GM's switch for everyone), "sfxWords" (client: the
   word set, auto = the game's language). Reduced motion: the module's own rule (config.reducedMotion) is passed to the engine. */
import { MODULE_ID, reducedMotion } from "../config.mjs";
import { api as moduleApi } from "../attrs.mjs";
import { perfMode } from "../perf-mode.mjs";
import { sharedNow } from "../shared-clock.mjs";
import { letters } from "../letters/index.mjs";
import { sfxBus } from "./bus.mjs";
import * as C from "./sfx-core.mjs";
import { langOf, VOICES } from "./words.mjs";
import * as FM from "../fire/model.mjs";
import * as Fire from "../fire/fire.mjs";

const GATHER_MS = 70;          // events of one moment are gathered this long before they are clustered (a Detonate's entries come a slice a frame)
const AMBIENT_EVERY = 6000;    // ms of the shared clock per ambient crackle slot
const MAX_AHEAD = 120000;      // events further ahead than this (a preset timed minutes ahead) are not scheduled
const LATE_MS = 450;           // a word whose moment is this far gone is not played (its event is over)

let L = null, loading = null;
let pending = [], gatherTimer = 0, sched = new Map();     // key -> timer of an event scheduled ahead
const seenEntry = new Map();   // area hash|start -> ms (an area waiting for its pixels enters twice)
const seenEvent = new Set();   // event keys already played or scheduled here
const alive = new Set();       // { box, h } words of this module on screen
let fireSeen = new Map();      // fire stroke id -> the stroke as last seen
let ambientTimer = 0, ambientSlot = -1;
const lastWord = new Map();    // voice -> the last text played here (the next one of that voice differs)
const stats = { events: 0, clusters: 0, words: 0, dropped: 0, late: 0, ms: 0 };

/* ---------------------------------------------------------------- settings */

const get = (k, d) => { try { return game.settings.get(MODULE_ID, k); } catch { return d; } };
export const mode = () => (get("sfxLettersWorld", true) === false ? "off" : get("sfxLetters", "all"));
const lang = () => langOf(get("sfxWords", "auto"), game.i18n?.lang);

function registerSettings() {
  const T = (k) => `MOINENMAPS.Sfx.${k}`;
  game.settings.register(MODULE_ID, "sfxLetters", { name: T("set"), hint: T("setHint"), scope: "client", config: true, type: String, default: "all",
    choices: { all: T("all"), big: T("big"), off: T("off") }, onChange: () => refresh() });
  game.settings.register(MODULE_ID, "sfxLettersWorld", { name: T("world"), hint: T("worldHint"), scope: "world", config: true, restricted: true, type: Boolean, default: true, onChange: () => refresh() });
  game.settings.register(MODULE_ID, "sfxWords", { name: T("words"), hint: T("wordsHint"), scope: "client", config: true, type: String, default: "auto",
    choices: { auto: T("wordsAuto"), en: T("wordsEn"), pl: T("wordsPl") } });
}

/* ---------------------------------------------------------------- the engine */

function engine() {
  if ( L ) return L;
  loading ??= letters().then((e) => (L = e)).catch((err) => { console.warn(`${MODULE_ID} | sfx: the lettering engine did not load`, err); loading = null; return null; });
  return null;
}

/* ---------------------------------------------------------------- events in */

const grid = () => canvas?.grid?.size || 100;
/** a shared-clock moment -> this page's performance clock */
const toPerf = (t) => performance.now() + (t - sharedNow());

/** An event at performance-clock time `t` (sfx-core EVENT): scheduled, gathered with its moment's other events, then played. */
export function add(e) {
  if ( mode() === "off" || !canvas?.ready ) return;
  if ( seenEvent.has(e.key) ) return;
  seenEvent.add(e.key);
  if ( seenEvent.size > 4000 ) { const it = seenEvent.values(); for ( let i = 0; i < 1000; i++ ) seenEvent.delete(it.next().value); }
  stats.events++;
  const ahead = e.t - performance.now();
  if ( ahead > MAX_AHEAD ) return;
  if ( ahead > GATHER_MS + 30 ) { sched.set(e.key, setTimeout(() => { sched.delete(e.key); queue(e); }, ahead - GATHER_MS)); return; }
  queue(e);
}
function queue(e) {
  pending.push(e);
  engine();
  if ( !gatherTimer ) gatherTimer = setTimeout(flush, GATHER_MS);
}

/** Destruction: a damage area enters (display.enter: any path, played, faded or off screen). */
function onEntry(d, g, opts, start) {
  const I = g?.info; if ( !I?.rect || !d?.origin ) return;
  const k = `${g.hash}|${Math.round(start / 100)}`;
  if ( seenEntry.has(k) ) return;
  const pn = performance.now();
  seenEntry.set(k, pn);
  if ( seenEntry.size > 600 ) for ( const [kk, t] of seenEntry ) if ( pn - t > 20000 ) seenEntry.delete(kk);
  const ap = d.ap || 1, o = d.origin, r = I.rect;
  const cx = Number.isFinite(I.ex) && (I.ex || I.ey) ? I.ex : (r.x0 + r.x1) / 2, cy = Number.isFinite(I.ey) && (I.ex || I.ey) ? I.ey : (r.y0 + r.y1) / 2;
  const w = Math.max(1, (I.w ?? r.x1 - r.x0)), h = Math.max(1, (I.h ?? r.y1 - r.y0));
  const gun = !!opts.path && !!g.objId && !!d.dropsOut?.(g.objId);
  const voice = C.destrVoice(I.type, I.cause | 0, gun);
  const speed = d.look?.speed || 1, k2 = 1 / speed;
  const p0 = opts.path?.[0] ?? opts.o ?? null;
  // (a cave-in's crash lands after its anticipation: collapse-entry.mjs ~200 ms; a gun's rounds land along its path)
  const lead = (I.type === "collapse" ? 230 : 0) * k2;
  // a gun's rounds: its walk (the path's own hit moments, ms from the start) for a stream of syllables along it
  const walk = gun && opts.path.length > 1 ? opts.path.map((q) => ({ x: o.x + q[0] * ap, y: o.y + q[1] * ap, ms: (q[2] || 0) * (opts.strict ? 1 : k2) })) : null;
  add({ walk, t0: start, key: `d|${g.hash}|${Math.round(start)}`, obj: g.objId ? `d${g.objId}` : null, voice, x: o.x + cx * ap, y: o.y + cy * ap,
    r: 0.5 * Math.sqrt(w * h) * ap, t: start + lead, colors: C.causeColors(I.cause | 0),
    from: p0 && (I.type !== "blast" || gun) ? { x: o.x + p0[0] * ap, y: o.y + p0[1] * ap } : null });
}

/** Fire: the layer's strokes changed (or the scene opened): the events of what is new or changed. */
function onFire(first = false) {
  if ( !canvas?.scene ) return;
  const now = sharedNow(), all = Fire.allStrokes?.() ?? new Map(), seen = new Map();
  const on = mode() !== "off" && Fire.shownHere?.();
  const geo = Fire.geo(), P = Fire.params0(), G = grid();
  const burningList = [...all.values()].filter((s) => s.k === "fire" && FM.burningAt(s, now));
  const ctx = { grid: G, catchMs: (st) => FM.catchMs(st, geo, P),
    burning: (er) => burningList.some((f) => overlapsStroke(f, er)), late: 1500, newLate: first ? 0 : C.NEW_LATE };
  for ( const st of all.values() ) {
    const prev = fireSeen.get(st.id) ?? null;
    seen.set(st.id, st);
    if ( !on ) continue;
    // a scene that opens: the stroke counts as seen - only its moments still to come (a preset's timed fire: its catch, spread,
    // out time); later, what is new or changed (a stroke new here plays its catch even when it reached this client late)
    const evs = first ? C.strokeEvents(st, null, now + 1, now + MAX_AHEAD, { ...ctx, late: 0, newLate: 0 }) : C.strokeEvents(st, prev, now, now + MAX_AHEAD, ctx);
    for ( const e of evs ) add({ ...e, t: toPerf(e.t) });
  }
  fireSeen = seen;
  armAmbient(burningList.length > 0 && on);
}
function overlapsStroke(f, er) {
  const r = (f.r ?? 50) + (er.r ?? 50), p = f.p ?? [], ex = er.p?.[0], ey = er.p?.[1];
  for ( let i = 0; i + 1 < p.length; i += 2 ) if ( Math.hypot(p[i] - ex, p[i + 1] - ey) < r ) return true;
  return false;
}

/** The ambient crackle of burning fires: a check a second while any burns. */
function armAmbient(on) {
  if ( !on || mode() !== "all" ) { clearInterval(ambientTimer); ambientTimer = 0; return; }
  if ( ambientTimer ) return;
  ambientTimer = setInterval(() => {
    if ( mode() !== "all" || !Fire.shownHere?.() ) return;
    const now = sharedNow(), slot = Math.floor((now + 1500) / AMBIENT_EVERY);
    if ( slot === ambientSlot ) return;
    ambientSlot = slot;
    const fires = [...(Fire.allStrokes?.() ?? new Map()).values()].filter((s) => s.k === "fire" && FM.burningAt(s, now));
    if ( !fires.length ) { armAmbient(false); return; }
    const e = C.ambientEvent(slot, fires, { every: AMBIENT_EVERY, grid: grid() });
    if ( e && e.t > now - 200 ) add({ ...e, t: toPerf(e.t) });
  }, 1000);
}

/* ---------------------------------------------------------------- words out */

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

function flush() {
  gatherTimer = 0;
  const now = performance.now();
  const due = pending.filter((e) => e.t <= now + GATHER_MS + 20), rest = pending.filter((e) => e.t > now + GATHER_MS + 20);
  pending = rest;
  if ( rest.length ) gatherTimer = setTimeout(flush, Math.max(10, Math.min(...rest.map((e) => e.t)) - now - GATHER_MS));
  if ( !due.length || mode() === "off" || !canvas?.ready ) return;
  if ( !L ) { engine(); loading?.then(() => { pending.push(...due.filter((e) => performance.now() - e.t < LATE_MS)); if ( !gatherTimer ) gatherTimer = setTimeout(flush, 0); }); return; }
  const t0 = performance.now();
  const pm = perfMode(), caps = C.CAPS[pm] ?? C.CAPS.high, G = grid(), big = mode() === "big";
  const v = view(), scale = canvas.stage.scale.x || 1, tokens = tokenBoxes(v);
  const groups = C.cluster(due, G).sort((a, b) => (VOICE_PRIO(b) - VOICE_PRIO(a)) || (b.rEq - a.rEq));
  stats.clusters += groups.length;
  const seed = canvas.scene?.id ?? "";
  for ( const g of groups ) {
    if ( g.ambient && [...alive].some((a) => a.ambient) ) { stats.dropped++; continue; }
    const words = C.planCluster(g, { lang: lang(), grid: G, sec: caps.sec, seed, big });
    // the same voice twice in a row here: the next word of its bank (the engine's hands differ anyway)
    const main = words.find((w) => w.role === "main");
    if ( main && lastWord.get(main.voice) === main.text && !g.ambient ) {
      const alt = C.planCluster(g, { lang: lang(), grid: G, sec: caps.sec, seed: seed + "~", big }).find((w) => w.role === "main");
      if ( alt && alt.text !== main.text ) main.text = alt.text;
    }
    const room = caps.alive - alive.size;
    if ( room <= 0 ) { stats.dropped += words.length; continue; }
    const placed = C.place(words, { scale, view: v, tokens, alive: [...alive].map((a) => a.box) }).slice(0, room);
    stats.dropped += words.length - placed.length;
    for ( const w of placed ) play(w, !!g.ambient);
    if ( main ) lastWord.set(main.voice, main.text);
  }
  stats.ms += performance.now() - t0;
}
const VOICE_PRIO = (g) => VOICES[g.main.voice]?.prio ?? 0;

function play(w, ambient) {
  const go = () => {
    if ( !L || mode() === "off" || !canvas?.ready ) return;
    if ( performance.now() - w.t > LATE_MS ) { stats.late++; return; }
    const red = reducedMotion();
    let h;
    try {
      if ( w.stream && L.stream ) { h = playStream(w, red); stats.words++; const rec = { box: w.box, h, ambient }; alive.add(rec); Promise.resolve(h?.finished).finally(() => alive.delete(rec)); return; }
      h = L.play(w.text, { space: "world", mood: w.mood, sound: w.sound, at: { x: w.x, y: w.y }, size: w.size, seed: w.seed,
        ...(w.maxWidth ? { maxWidth: w.maxWidth } : {}), ...(w.from ? { from: w.from } : {}), rotation: w.rotation, startAt: Math.min(w.t, performance.now()),
        ...(w.colors ? { colors: w.colors } : {}), ...(w.hold ? { hold: w.hold } : {}), reduced: red });
    } catch ( err ) { console.warn(`${MODULE_ID} | sfx: a word did not play`, err); return; }
    stats.words++;
    const rec = { box: w.box, h, ambient };
    alive.add(rec);
    Promise.resolve(h?.finished).finally(() => alive.delete(rec));
  };
  const wait = w.t - performance.now();
  if ( wait > 4 ) { const id = setTimeout(() => { sched.delete(id); go(); }, wait); sched.set(id, id); } else go();
}

/** A gun's rattle: one syllable per round where and when it lands (its walk), one look for the whole burst (LETR stream). */
function playStream(w, reduced) {
  const W = w.stream.walk, T = W.at(-1).ms || 1, t0 = w.stream.t0;
  const beats = [...new Set(Array.from({ length: Math.min(8, Math.max(3, W.length)) }, (_, i, a) => Math.round(T * (a.length > 1 ? i / (a.length - 1) : 0))))];
  const at = () => {
    const ms = performance.now() - t0;
    let i = 1; while ( i < W.length - 1 && W[i].ms < ms ) i++;
    const a = W[i - 1], b = W[i], f = b.ms > a.ms ? Math.min(1, Math.max(0, (ms - a.ms) / (b.ms - a.ms))) : 1;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  };
  return L.stream({ text: w.text.split("\n").join(" "), space: "world", at, dir: -90, beats, startAt: t0, mood: w.mood, size: w.size * 0.6, seed: w.seed,
    ...(w.colors ? { colors: w.colors } : {}), loud: (i) => 0.75 + 0.25 * Math.sin(i * 1.7), reduced });
}

/* ---------------------------------------------------------------- lifecycle */

function teardown() {
  clearTimeout(gatherTimer); gatherTimer = 0; pending = [];
  for ( const id of sched.values() ) clearTimeout(id);
  sched.clear(); alive.clear(); seenEntry.clear(); fireSeen = new Map();
  armAmbient(false); ambientSlot = -1;
}
function refresh() {
  sfxBus.entry = mode() === "off" ? null : onEntry;
  if ( mode() === "off" ) { for ( const id of sched.values() ) clearTimeout(id); sched.clear(); pending = []; armAmbient(false); }
  else if ( canvas?.ready ) { fireSeen = new Map([...(Fire.allStrokes?.() ?? new Map())].map(([k, v]) => [k, v])); onFire(true); }
}

export const sfxApi = {
  /** How it stands: events seen, clusters, words played / dropped / late, planning ms in total, words alive. */
  status: () => ({ mode: mode(), lang: lang(), engine: L?.version ?? null, alive: alive.size, ...stats }),
  /** Plan (no play) the words of events [{ voice, x, y, r, t?, key? }] here and now: for checks and the docs. */
  plan: (events) => C.cluster(events.map((e, i) => ({ key: `p${i}`, t: performance.now(), ...e })), grid())
    .flatMap((g) => C.planCluster(g, { lang: lang(), grid: grid(), sec: (C.CAPS[perfMode()] ?? C.CAPS.high).sec, seed: canvas.scene?.id ?? "" })),
  /** Play events now (scene px): `api.sfx.test([{ voice: "crash", x, y, r: 300 }])`. */
  test: (events) => { const t = performance.now() + 30; for ( const [i, e] of events.entries() ) add({ key: `test|${Date.now()}|${i}`, t, ...e }); },
  core: C
};

export function registerSfx() {
  moduleApi.sfx = sfxApi;
  Hooks.once("init", registerSettings);
  Hooks.once("ready", () => { refresh(); const m = game.modules.get(MODULE_ID); if ( m?.api ) m.api.sfx ??= sfxApi; });
  Hooks.on("canvasReady", () => { teardown(); refresh(); });
  Hooks.on("canvasTearDown", teardown);
  Hooks.on("moinenMapsFire", (kind) => { if ( kind === "edited" || kind === "loaded" ) { if ( kind === "loaded" ) { fireSeen = new Map(); onFire(true); } else onFire(false); } });
}
