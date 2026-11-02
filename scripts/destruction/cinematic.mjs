import { MODULE_ID } from "../config.mjs";
import * as Cin from "./cinematic-core.mjs";

/**
 * CINEMATIC MODE, the runtime: staging, hiding, the show (cinematic-core.mjs holds the pure parts and the data model).
 *
 *  - A STAGED stroke carries `cin` { s: "p" | "y" | "d", q, t, o?, d? } (set by destruction.mjs edited()). While it is "p" it is baked and
 *    fetched like any stroke but NOT put on screen (destruction.mjs showRecs asks `holds(o)`): not for the players, and not for the GM
 *    unless "GM preview" is on (then it shows at once, with a thin outline). A scene reload keeps pending ones hidden, played ones settled.
 *  - ACTION (a GM): the queue is frozen into one show record under flags.moinen-maps.cinShows.<userId> (settings snapshot, the stroke ids, their
 *    start offsets on the shared clock, t0). EVERY client, from that record and the shared clock, puts each stroke on screen LEAD ms before
 *    its start with an entry whose start is in the future, so all of them start within a frame or two of each other. The GM who clicked
 *    (or, when they leave, the active GM) flips the strokes' `cin.s` (p -> y when one starts, y -> d when it is over) and saves them: that is
 *    all a later load needs. If every GM leaves, the clients complete the show from the record; a GM who comes back settles what is left.
 *  - TOKENS carried by a staged stroke stay where they are until the stroke plays (tokens/carry.mjs: the carry runs with the entry; the
 *    real move is made at its end by ONE GM client). Undo of a staged stroke needs no token move (it never moved).
 *  - screen effects: `CinematicFx` (cinematic-fx.mjs, optional: when the file is missing everything below still works).
 *  - kill switch: CONFIG.moinenMaps.noCinematic = true: the mode is ignored, nothing is staged, everything on screen at once.
 */
export const HOOK = "moinenMapsCinematic";
export const FLAG = "cinShows";

let host = null;                          // destruction.mjs: { state, display, save, reveal, refresh, now, real }
let Fx = null, fxTried = false;
const NOOP_FX = { begin() {}, impact() {}, end() {}, active: false };
const fx = () => Fx ?? NOOP_FX;

const revealed = new Set();               // strokes put on screen by the show on this client (shown whatever the flag says)
const scheduled = new Set();              // strokes in the running show whose reveal moment has not come
let run = null;                           // the show this client is playing: { show, timers: [], fired: Set, ended, started }
let outlines = null;                      // the GM's thin outline of staged strokes (PIXI.Graphics)
let lastEnded = "";                       // the id of the last show that ended here (a flag echo must not start it again)

export const killed = () => !!globalThis.CONFIG?.moinenMaps?.noCinematic;
const S = () => host?.state() ?? null;
const P = () => Cin.sanitize(S()?.params?.cinematic);
const gm = () => !!game.user?.isGM;
export const modeOf = () => (killed() ? "off" : P().mode);
export const previewOn = () => gm() && P().preview;

/** The staged strokes (pending, in painting order). */
export const pending = () => Cin.queue(S()?.objects);
export const stagedCount = () => (killed() ? 0 : Cin.stagedCount(S()?.objects));
/** Is this stroke pending (staged and not played yet)? */
export const isPending = (id) => { const o = S()?.objects?.find((q) => q.id === id); return !killed() && !!o && Cin.hidden(o) && !revealed.has(id); };
/** Should this client leave the stroke off its display? (destruction.mjs showRecs) */
export const holds = (o) => Cin.holdsStroke(o, { killed: killed(), revealed, scheduled, gmPreview: previewOn() });
/** The staged strokes the GM's display shows (preview): the composite must not be published with them. */
export const blocksComposite = () => gm() && !killed() && previewOn() && stagedCount() > 0;
export const showing = () => !!run && !run.ended;
export const currentShow = () => run?.show ?? null;
export const status = () => ({ mode: modeOf(), preview: P().preview, staged: stagedCount(), showing: showing(), showId: run?.show?.id ?? null, killed: killed(),
  scheduled: [...scheduled], revealed: [...revealed], fx: !!Fx });

/* ---------------------------------------------------------------- wiring */

export function bind(h) { host = h; }

async function loadFx() {
  if ( fxTried ) return Fx;
  fxTried = true;
  try { const m = await import("./cinematic-fx.mjs"); Fx = m.CinematicFx ?? m.default ?? null; }
  catch ( err ) { Fx = null; if ( !String(err?.message ?? err).match(/Failed to fetch|import|not found|Cannot find|404/i) ) console.warn(`${MODULE_ID} | cinematic: effects unavailable`, err); }
  return Fx;
}

export function register() {
  Hooks.on("updateScene", onUpdateScene);
  Hooks.on("userConnected", onUser);
  Hooks.on("moinenMapsDestruction", (kind) => { if ( kind === "loaded" ) onLoaded(); if ( kind === "edited" || kind === "params" || kind === "loaded" ) outlineSoon(); });
  document.addEventListener("keydown", onKey, true);
  loadFx();
}

/** Shift+Enter: Action! (GM, a staged queue, no show running; the key is left alone while typing). */
function onKey(ev) {
  if ( ev.key !== "Enter" || !ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey || !gm() ) return;
  const t = ev.target;
  if ( t?.closest?.("input, textarea, select, [contenteditable=true], prose-mirror") ) return;
  if ( !canvas?.ready || !S() || !stagedCount() || showing() ) return;
  ev.preventDefault(); ev.stopPropagation();
  action();
}

/** The scene changed (teardown) or was cleared: nothing of this client's show stays. */
export function reset() {
  stopRun(false);
  revealed.clear(); scheduled.clear();
  clearOutlines();
}

/* ---------------------------------------------------------------- the show record (flag) */

const flagOf = (scene = canvas.scene) => scene?.flags?.[MODULE_ID]?.[FLAG] ?? null;
const sharedNow = () => host.now();

function onUpdateScene(scene, changed) {
  if ( scene.id !== canvas.scene?.id ) return;
  const f = changed.flags?.[MODULE_ID];
  if ( !f || !(FLAG in f || `-=${FLAG}` in f) ) return;
  consider("flag");
}
function onUser(user, connected) { if ( !connected && run && !run.ended && user.id === run.show.by ) consider("owner-left"); }
function onLoaded() { if ( !S() ) return; consider("loaded"); outlineSoon(); }

/** Look at the flag and start, keep or drop this client's show accordingly. */
export function consider(why = "") {
  if ( killed() || !S() || !canvas.scene ) return;
  const now = sharedNow(), map = flagOf(), show = Cin.pickShow(map, now);
  if ( !show ) { if ( run && !run.ended && why === "flag" ) { /* the record was removed: the owner ended it; let the local timeline finish */ } settleIfOver(map, now); return; }
  if ( run && !run.ended && run.show.id === show.id ) return;
  if ( show.id === lastEnded ) return;
  if ( run && !run.ended ) stopRun(true);              // a show that started earlier replaces ours (firstWins)
  startRun(show);
}

/** A GM who finds a show that is over (everyone left, or this GM came back): the strokes still pending in it are settled and the record goes. */
function settleIfOver(map, now) {
  if ( !gm() || !map || !game.users.activeGM?.isSelf ) return;
  const over = Object.entries(map).filter(([, s]) => s && typeof s === "object" && (!Cin.validShow(s) || !Cin.showLive(s, now) || now > Cin.showEnd(s)));
  if ( !over.length ) return;
  const ids = new Set(over.flatMap(([, s]) => s?.snap?.ids ?? []));
  settleIds(ids);
  const upd = {};
  for ( const [uid] of over ) upd[`flags.${MODULE_ID}.${FLAG}.-=${uid}`] = null;
  canvas.scene.update(upd).catch(() => {});
}

/** Strokes of `ids` still p or y become d (GM), saved. */
function settleIds(ids) {
  const st = S(); if ( !st ) return 0;
  let n = 0;
  st.objects = st.objects.map((o) => { if ( !ids.has(o.id) || !o.cin || o.cin.s === "d" ) return o; n++; return { ...o, cin: { ...o.cin, s: "d" } }; });
  if ( n ) { host.moved(); host.save().catch(() => {}); host.refresh("settle"); }
  return n;
}

/* ---------------------------------------------------------------- Action! */

/** The GM's big button: the queue becomes a show. Returns the show record, or null (nothing to do / a show is running). */
export async function action() {
  if ( !gm() || killed() || !S() || !canvas.scene ) return null;
  const st = S(), q = pending();
  if ( !q.length ) return null;
  if ( showing() || Cin.pickShow(flagOf(), sharedNow()) ) return null;
  await loadFx();
  await host.save();                                       // (the strokes first: every client has them, with their queue, before the record)
  const users = fx().userPresets?.() ?? {};
  const show = Cin.makeShow({ id: foundry.utils.randomID(8), by: game.user.id, at: sharedNow(), objs: st.objects, c: st.params.cinematic, users });
  await canvas.scene.update({ [`flags.${MODULE_ID}.${FLAG}.${game.user.id}`]: show });
  consider("action");
  return show;
}

/** "Reveal now": every staged stroke (the show's rest, or the whole queue) is on screen at once, settled, and written as played. GM. */
export async function skip() {
  if ( !gm() || !S() ) return 0;
  const ids = new Set(pending().map((o) => o.id));
  for ( const o of S().objects ) if ( o.cin?.s === "y" ) ids.add(o.id);
  const map = flagOf();
  if ( run && !run.ended ) stopRun(true);
  for ( const id of ids ) revealed.add(id);
  scheduled.clear();
  const n = settleIds(ids);
  if ( map && canvas.scene ) { const upd = {}; for ( const uid of Object.keys(map) ) upd[`flags.${MODULE_ID}.${FLAG}.-=${uid}`] = null; await canvas.scene.update(upd).catch(() => {}); }
  host.refresh("skip");
  return n;
}

/* ---------------------------------------------------------------- playing a show (every client) */

function startRun(show) {
  const st = S(); if ( !st ) return;
  const now = sharedNow(), tl = Cin.timeline(show, now).filter((q) => st.objects.some((o) => o.id === q.id));
  run = { show, timers: [], fired: new Set(), ended: false, started: false, stats: { reveals: 0, late: 0 }, startAt: new Map() };
  const ids = new Set(tl.map((q) => q.id));
  // a stroke whose moment has not come stays off the screen (even when a GM's write already says it plays), one whose moment passed is settled
  for ( const q of tl ) { if ( q.phase === "now" ) { if ( !revealed.has(q.id) ) run.stats.late++; revealed.add(q.id); } else scheduled.add(q.id); }
  Hooks.callAll(HOOK, "start", { show, ids: [...ids] });
  const ms = (shared) => Math.max(0, shared - now);
  const end = Cin.showEnd(show);
  // 1. the screen effects begin with the show (the pause before the first stroke is theirs: the bars close in)
  const begin = () => {
    if ( !run || run.show !== show || run.started ) return;
    run.started = true;
    try { fx().begin(show.snap, { strokes: strokesOf(show, tl), bounds: boundsOf(tl), t0: show.t0, id: show.id }); } catch ( err ) { console.warn(`${MODULE_ID} | cinematic: fx.begin`, err); }
  };
  run.timers.push(setTimeout(begin, ms(show.t0)));
  // 2. each stroke: on screen LEAD before its start, its impact at the start
  for ( const q of tl ) {
    if ( q.phase === "now" ) continue;
    run.timers.push(setTimeout(() => reveal(q), ms(q.revealAt)));
    run.timers.push(setTimeout(() => impact(q), ms(q.startAt)));
  }
  // 3. the end: once the last stroke has stopped moving (or at the schedule's end)
  const last = tl.at(-1);
  run.timers.push(setTimeout(() => finish(show), ms(last ? last.startAt + 1200 : show.t0)));
  run.timers.push(setTimeout(() => stopRun(true, show), ms(end) + 20000));
  if ( now > show.t0 ) begin();
  outlineSoon();
  host.tell("cin");
}

function strokesOf(show, tl) {
  const st = S(), out = [];
  for ( const q of tl ) {
    const o = st.objects.find((p) => p.id === q.id); if ( !o ) continue;
    const g = geom(o);
    out.push({ id: o.id, start: q.startAt, x: g.x, y: g.y, size: g.size, box: g.box, big: Cin.isBig(o, show.snap.r), path: o.p ?? null, tk: !!o.tk });
  }
  return out;
}
const boundsOf = (tl) => { const st = S(), pts = tl.map((q) => st.objects.find((o) => o.id === q.id)).filter(Boolean).map((o) => geom(o).box); if ( !pts.length ) return null; return pts.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) })); };
/** A stroke's place in SCENE pixels: its impact point (cin.o in art px, else the box centre), its box, its size (the larger side). */
function geom(o) {
  const g = host.geo(), K = g.K, c = o.cin;
  const box = { x0: g.ox + o.x0 * K * g.ap, y0: g.oy + o.y0 * K * g.ap, x1: g.ox + (o.x0 + o.w) * K * g.ap, y1: g.oy + (o.y0 + o.h) * K * g.ap };
  const at = c?.o ? [g.ox + c.o[0] * g.ap, g.oy + c.o[1] * g.ap] : [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
  return { x: at[0], y: at[1], box, size: Math.max(box.x1 - box.x0, box.y1 - box.y0) };
}

function reveal(q) {
  if ( !run || run.show.id !== currentId() || run.fired.has(q.id) ) return;
  const st = S(), o = st?.objects.find((p) => p.id === q.id);
  run.fired.add(q.id);
  if ( !o ) { scheduled.delete(q.id); return; }                // undone or cleared meanwhile
  const wait = Math.max(0, q.startAt - sharedNow());           // shared ms until the stroke's start (the entry's start is then in the future)
  const start = performance.now() + wait, c = o.cin ?? {};
  const mine = owner();                                       // the GM client that moves the carried token for real, once
  scheduled.delete(q.id); revealed.add(q.id);
  run.stats.reveals++;
  run.startAt.set(q.id, { shared: q.startAt, perf: start });
  const ok = host.reveal(q.id, { start, o: c.o ?? null, d: c.d ?? null, real: mine });
  Hooks.callAll(HOOK, "stroke", { id: q.id, index: q.i, start: q.startAt, shown: ok });
  if ( mine ) flip(q.id, "y");
}
function impact(q) {
  if ( !run || run.show.id !== currentId() ) return;
  const o = S()?.objects.find((p) => p.id === q.id); if ( !o ) return;
  const g = geom(o);
  try { fx().impact({ x: g.x, y: g.y, size: g.size, t: q.startAt, id: q.id, big: Cin.isBig(o, run.show.snap.r) }); } catch ( err ) { console.warn(`${MODULE_ID} | cinematic: fx.impact`, err); }
  Hooks.callAll(HOOK, "impact", { id: q.id, x: g.x, y: g.y, size: g.size, t: q.startAt });
}
const currentId = () => run?.show?.id;
/** Is this client the one that writes the flags and moves the real tokens? The show's GM while they are here, else the active GM. */
function owner(show = run?.show) {
  if ( !gm() || !show ) return false;
  const who = Cin.ownerOf(show, (uid) => !!game.users.get(uid)?.active, game.users.activeGM?.id);
  return who === game.user.id;
}

/** Writes one stroke's `cin.s` forward (GM), saved at once: p -> y when it starts; the earlier y -> d. */
function flip(id, to) {
  const st = S(); if ( !st ) return;
  let changed = false;
  st.objects = st.objects.map((o) => {
    if ( !o.cin ) return o;
    if ( o.id === id && o.cin.s !== to ) { const n = Cin.flipped(o, to); if ( n.cin !== o.cin ) { changed = true; return n; } }
    if ( to === "y" && o.id !== id && o.cin.s === "y" && run?.show.snap.ids.includes(o.id) && run.fired.has(o.id) ) { changed = true; return Cin.flipped(o, "d"); }
    return o;
  });
  if ( changed ) { host.moved(); host.save().catch((err) => console.warn(`${MODULE_ID} | cinematic: could not write the stroke state`, err)); }
}

/** The last stroke has started: when its entry has stopped (or a cap), the show ends. */
function finish(show) {
  if ( !run || run.show !== show || run.ended ) return;
  const d = host.display(), ids = new Set(show.snap.ids);
  const busy = () => (d?.order ?? []).some((g) => ids.has(g.objId) && g.anim);
  const t0 = performance.now(), cap = 20000;
  const wait = () => {
    if ( !run || run.show !== show || run.ended ) return;
    if ( busy() && performance.now() - t0 < cap ) return void (run.timers.push(setTimeout(wait, 250)));
    const pause = show.snap.r.pauseAfter / Math.max(0.05, show.snap.r.timeScale);
    run.timers.push(setTimeout(() => stopRun(true, show), pause));
  };
  wait();
}

/** The show is over on this client: the effects end, the owner writes the strokes as played and removes the record. */
function stopRun(clean = true, only = null) {
  if ( !run || (only && run.show !== only) ) return;
  const r = run; run = null;
  for ( const t of r.timers ) clearTimeout(t);
  r.ended = true;
  const ids = r.show.snap.ids;
  for ( const id of ids ) scheduled.delete(id);
  if ( clean ) {
    lastEnded = r.show.id;
    try { fx().end(); } catch ( err ) { console.warn(`${MODULE_ID} | cinematic: fx.end`, err); }
    Hooks.callAll(HOOK, "end", { id: r.show.id, reveals: r.stats.reveals });
    if ( gm() && canvas.scene && (r.show.by === game.user.id || !game.users.get(r.show.by)?.active) && game.users.activeGM?.isSelf ) {
      const set = new Set(ids); settleIds(set);
      canvas.scene.update({ [`flags.${MODULE_ID}.${FLAG}.-=${r.show.by}`]: null }).catch(() => {});
    }
  } else { try { fx().end(); } catch { /* torn down */ } }
  host.tell("cin");
}

/* ---------------------------------------------------------------- staged outline (the GM's preview) */

let outlineTimer = 0;
function outlineSoon() { clearTimeout(outlineTimer); outlineTimer = setTimeout(drawOutlines, 120); }
function clearOutlines() { clearTimeout(outlineTimer); if ( outlines && !outlines.destroyed ) outlines.destroy({ children: true }); outlines = null; }
function drawOutlines() {
  const show = gm() && !killed() && previewOn() && canvas?.ready && S();
  if ( !show || !stagedCount() ) { if ( outlines ) outlines.visible = false; return; }
  const layer = canvas.interface ?? canvas.stage;
  if ( !outlines || outlines.destroyed ) { outlines = new PIXI.Graphics(); outlines.name = "mm-cin-staged"; outlines.eventMode = "none"; layer.addChild(outlines); }
  outlines.visible = true; outlines.clear();
  outlines.lineStyle({ width: 2, color: 0xffd36e, alpha: 0.55 });
  for ( const o of pending() ) { const b = geom(o).box; outlines.drawRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); }
}

/** For the checks (dev/cinematic-check.mjs): the shared clock, the running show's per-stroke start moments (shared and this page's performance.now()). */
const runInfo = () => run ? { id: run.show.id, by: run.show.by, t0: run.show.t0, ids: run.show.snap.ids, offs: run.show.offs, fired: [...run.fired], starts: Object.fromEntries(run.startAt), started: run.started, owner: owner() } : null;
/** After CONFIG.moinenMaps.noCinematic changed at run time (it is meant to be set before the world loads): the display follows. */
const refreshNow = () => host?.refresh("kill");
export const _api = { refresh: refreshNow, pending, status, holds, isPending, action, skip, consider, modeOf, killed, now: () => host?.now(), runInfo };
