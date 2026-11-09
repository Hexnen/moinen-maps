import { MODULE_ID } from "../config.mjs";
import { api as moduleApi } from "../attrs.mjs";
import * as M from "./model.mjs";
import * as Look from "./look.mjs";
import { FireDisplay } from "./display.mjs";
import { sharedNow } from "../shared-clock.mjs";
import * as DModel from "../destruction/model.mjs";
import * as D from "../destruction/destruction.mjs";
import { reducedMotion } from "../config.mjs";
import { warmPrograms } from "../gl-warm.mjs";
import { artPrograms } from "./art.mjs";
import { dustPrograms } from "./dust-art.mjs";
import { burstPrograms } from "./burst-art.mjs";
import { fireballProgram } from "./shader.mjs";
import { damperProgram } from "./rain-damp.mjs";
import { fireWet } from "../wind.mjs";

/**
 * FIRE AND SMOKE, the engine: the strokes of the open scene (scene flags, model.mjs), the display (display.mjs), the GM's edits
 * (each stroke one flag key; undo / redo of whole strokes; a clear), other clients' saves followed. Nothing is baked, published or
 * uploaded: every client computes the same areas and fields from the same strokes, and the same frame from the shared clock.
 * The fields are computed in workers (raster-worker.mjs; the main thread only lays out the areas): an area whose new field is not
 * ready yet keeps showing the previous one of the same place, so painting, releasing, undo / redo and remote strokes never stall.
 * Public API: `game.modules.get("moinen-maps").api.fire`. Hook fired: "moinenMapsFire" ("loaded" | "edited" | "params" | "brush").
 */
let strokes = new Map();            // id -> stroke (stored)
let params = M.cleanParams();
let draft = null;                   // the stroke being painted (not stored yet)
let display = null;
let fields = new Map();             // area key -> field (cache: an unchanged area is not rasterized again)
let lastAreas = [];
let lastItems = [];                 // what the display shows now: { area, field } (a new area waits on one of these: no blank frame)
let drawFrame = 0;
const undoStack = [], redoStack = [];
const UNDO_MAX = 100;
let extra = new Map();              // other sources of fire (a destruction stroke later on): id -> { area, field }
let phaseTimer = 0;                 // the next phase change (a stroke done growing / gone out): one redraw then
let purging = false;

export const tell = (kind) => Hooks.callAll("moinenMapsFire", kind);
export const params0 = () => params;
// (the panel's list: every stroke still burning - a preset's timed fire too, whose out time is still to come: model.burningAt)
export const list = () => { const now = sharedNow(); return [...strokes.values()].filter((s) => M.burningAt(s, now)).sort(M.byOrder); };

/** The art grid this layer draws on: the destruction layer's (same ap, same origin), else the formula it would use. */
export function geo() {
  const r = DModel.sceneRect(), ap = D.state()?.ap ?? DModel.artPx();
  return { ap, ox: r.x, oy: r.y, grid: canvas.grid?.size ?? 100 };
}

/** Does this client show the layer? */
const shown = () => params.on && (params.who !== "gm" || game.user.isGM);

/* ---------------------------------------------------------------- load / follow */

function load(scene = canvas.scene) {
  const F = scene?.flags?.[MODULE_ID] ?? {};
  params = M.cleanParams(F[M.FLAG]);
  strokes = new Map(M.strokesOf(F[M.STROKES]).map((s) => [s.id, s]));
}

function onCanvasReady() {
  teardown();
  if ( !canvas.scene ) return;
  load();
  prewarm();
  if ( !warming ) idleWarm();
  draw();
  tell("loaded");
}

/**
 * A scene that opens WITHOUT fire still warms the fire's programs, a few seconds after it opened, when the page is idle: the first
 * stroke another client paints then shows at once. Before, the warm-up began only when that stroke arrived, and on a program-cache
 * miss the art program alone links for 5-20 s on D3D11 (measured: 14 s, a fresh Chrome profile) - the player saw no fire that long.
 * Background links only (KHR_parallel_shader_compile), nothing drawn: no pixel changes. Cancelled by a scene change (warmJob).
 */
let idleTimer = 0;
function idleWarm() {
  clearTimeout(idleTimer);
  const job = warmJob;
  idleTimer = setTimeout(() => {
    const go = () => { if ( job === warmJob && !warming && !display ) prewarm(true); };
    if ( globalThis.requestIdleCallback ) requestIdleCallback(go, { timeout: 2000 }); else go();
  }, IDLE_WARM_MS);
}
const IDLE_WARM_MS = 3000;

/**
 * The fire is about to be painted (the GM picked the fire or smoke tool, or opened the fire panel): its programs are warmed now, in
 * the background, if they are not yet - a scene that opened without fire no longer compiles them on the first stroke. Never blocks;
 * never twice (prewarm).
 */
export function warmUp() { prewarm(true); }
/**
 * The EXPLOSION programs (burst + dust: a destruction preset's bomb / grenade / rocket / meteor) linked in the background before any
 * firing (presets/blast-wire.mjs: when the scene is ready, when a pad is armed): a firing writes its burst only ~1 s before its impact
 * and a cold link of these took longer, so the first fireball of a session showed late. Only the programs: no pixel changes.
 */
let burstWarming = null;
export function warmBurst() {
  if ( burstWarming || CONFIG.moinenMaps?.firePrewarm === false || !canvas?.ready || !shown() ) return burstWarming;
  const uid = canvas.app.renderer.CONTEXT_UID, list = [...artPrograms(), ...burstPrograms(), ...dustPrograms()].filter((p) => !p.glPrograms?.[uid]);
  if ( !list.length ) return null;
  const live = () => !!canvas?.ready;
  return burstWarming = warmPrograms(list, live).catch(() => {}).finally(() => { burstWarming = null; });
}

/**
 * PRE-WARM (gl-warm.mjs): when the scene opens with fire or smoke this client shows, every fire program it will draw with is compiled
 * and linked in the background (KHR_parallel_shader_compile; else one per idle callback) - the first fire draw of a session no longer
 * blocks on the GPU process for the links (seconds on a program-cache miss). Meanwhile the fire's first display waits for it (draw):
 * the fire shows when its programs are ready - the same picture, a moment later, never a frozen frame. Only the programs: no pixel
 * changes. `CONFIG.moinenMaps.firePrewarm = false` turns it off.
 */
let warmJob = 0, warming = null;
function prewarm(force = false) {
  if ( warming ) return;                                              // (one at a time: a second ask while it runs is the same warm-up)
  if ( CONFIG.moinenMaps?.firePrewarm === false || !canvas.ready || !shown() || (!force && !strokes.size && !draft) ) return;
  const list = [...artPrograms()];
  // (DUST: its own programs, when the scene has dust or a brush may paint it)
  if ( force || [...strokes.values()].some((s) => s.k === "dust") || draft?.k === "dust" ) list.push(...dustPrograms());
  // (the EXPLOSION FIRE: its own programs, when the scene has a burst - a preset writes it ahead of its impact)
  if ( [...strokes.values()].some((s) => s.k === "burst") ) list.push(...burstPrograms());
  const ball = [...strokes.values()].some((s) => s.st === "fireball") || draft?.st === "fireball"
    || (force && game.user.isGM && (() => { try { return game.settings.get(MODULE_ID, "fireStyle") === "fireball"; } catch { return false; } })());
  if ( ball ) list.push(fireballProgram());
  const wet = fireWet(); if ( wet && (wet.dim > 0.001 || wet.steam > 0.001) ) list.push(damperProgram());
  const uid = canvas.app.renderer.CONTEXT_UID;
  if ( list.every((p) => p.glPrograms?.[uid]) ) return;              // (already warm: compiled earlier this session)
  const job = ++warmJob;
  const live = () => job === warmJob && canvas.ready;
  const tl = timing(), t0 = performance.now();
  warming = warmPrograms(list, live).catch(() => {}).finally(() => {
    if ( job !== warmJob ) return;
    warming = null;
    if ( tl ) tl.push({ warm: +(performance.now() - t0).toFixed(1), programs: list.length, at: +t0.toFixed(1) });
    scheduleDraw();
  });
}

function teardown() {
  warmJob++; warming = null; clearTimeout(idleTimer); idleTimer = 0;
  cancelAnimationFrame(drawFrame); drawFrame = 0;
  clearTimeout(phaseTimer); phaseTimer = 0;
  display?.destroy(); display = null;
  fields.clear(); lastAreas = []; lastItems = []; draft = null; ready.clear(); queued.clear();
  undoStack.length = redoStack.length = 0;
}

function onUpdateScene(scene, changed) {
  if ( scene.id !== canvas.scene?.id ) return;
  const f = changed?.flags?.[MODULE_ID]; if ( !f ) return;
  if ( ![M.FLAG, M.STROKES, `-=${M.STROKES}`, `-=${M.FLAG}`].some((k) => k in f) ) return;
  load(scene);
  // (the first fire on a scene that had none, painted by another client: its programs warmed as the edit arrives - the new areas'
  // adoption waits for them, the page stays responsive)
  if ( !display ) prewarm();
  scheduleDraw();
  tell(M.FLAG in f ? "params" : "edited");
}

/* ---------------------------------------------------------------- the field worker */

// An area's field is computed in a worker (raster-worker.mjs; ~20-150 ms for a big area, more with torn edges), and a finished field
// waits in `ready` until the next draw adopts it. Without a worker (it failed to start) the field is computed here, as before.
// A12c - a small POOL (two workers on a 4-core CPU or more, one below; the second started only when the first is busy), each given
// ONE job at a time: the newest request of an area replaces its queued one until a worker is free (painting asks ~12 times a second),
// and a newer request of an area whose older field is still being computed starts at once on a free worker - the field of a release
// no longer waits behind the last draft's (a big area takes ~300 ms on a fast CPU, three times that on an old one).
// (localStorage "mm-fire-worker" = "off": fields on the main thread, for comparing / debugging)
let workers = null, workerOff = (() => { try { return globalThis.localStorage?.getItem("mm-fire-worker") === "off"; } catch { return false; } })();
const ready = new Map(), queued = new Map(), running = new Set();   // key -> field; area id -> job (the newest asked); keys in work
const failed = new Set();           // keys the worker could not do (computed here then)
const POOL = Math.max(1, Math.min(2, (globalThis.navigator?.hardwareConcurrency ?? 2) - 2));
const route = () => new URL("./raster-worker.mjs", import.meta.url);
// DEV TIMING (off unless `CONFIG.moinenMaps.fireTiming` is an array; then each field job and each draw appends a record to it):
// { job: key, post (ms, performance.now), work (ms in the worker), back (ms posted -> received) } / { draw: ms, areas: ms, sync: ms,
// n: areas, built: new meshes }. Off it costs one property read per job and per draw.
const timing = () => globalThis.CONFIG?.moinenMaps?.fireTiming;
const posted = new Map();           // key -> performance.now() at post (only while timing)
function spawn() {
  const slot = { w: new Worker(route(), { type: "module" }), key: null };
  slot.w.onmessage = (ev) => {
    const { key, field, err, ms } = ev.data;
    const tl = timing(); if ( tl && posted.has(key) ) { tl.push({ job: key, post: posted.get(key), work: ms, back: performance.now() - posted.get(key) }); posted.delete(key); }
    slot.key = null; running.delete(key);
    if ( field ) ready.set(key, field); else { failed.add(key); console.warn(`${MODULE_ID} | fire: field worker`, err); }
    pump();
    scheduleDraw();
  };
  slot.w.onerror = (e) => { console.warn(`${MODULE_ID} | fire: field worker off, fields on the main thread`, e?.message ?? e); stopWorker(true); scheduleDraw(); };
  workers.push(slot);
  return slot;
}
function startWorker() {
  if ( workers || workerOff ) return !!workers;
  try { workers = []; spawn(); } catch { workerOff = true; workers = null; }
  return !!workers;
}
function stopWorker(off = false) { for ( const s of workers ?? [] ) s.w.terminate(); workers = null; workerOff ||= off; queued.clear(); running.clear(); }
/** Hand the queued jobs (oldest area first) to free workers, a second worker started when the first is busy. */
function pump() {
  if ( !workers ) return;
  for ( const [id, job] of queued ) {
    let slot = workers.find((s) => !s.key);
    if ( !slot && workers.length < POOL ) { try { slot = spawn(); } catch { slot = null; } }
    if ( !slot ) return;
    queued.delete(id); slot.key = job.key; running.add(job.key);
    if ( timing() ) { posted.set(job.key, performance.now()); job.t = true; }
    slot.w.postMessage(job);
  }
}
/** Ask for an area's field; false when there is no worker (the caller rasterizes it itself). */
function request(a, g) {
  if ( !startWorker() ) return false;
  if ( running.has(a.key) || ready.has(a.key) ) return true;
  queued.set(a.id, { key: a.key, area: a, geo: g, P: params });
  pump();
  return true;
}
const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/* ---------------------------------------------------------------- drawing */

export function scheduleDraw() {
  if ( drawFrame ) return;
  drawFrame = requestAnimationFrame(() => { drawFrame = 0; draw(); });
}

/**
 * Compute the areas at this moment (phases from the shared clock: growing, burning, going out) and the fields of the new ones, and
 * show them. With nothing to show the display is not even made. The next phase change is one timer (a redraw then: a new field
 * without the times texture once a stroke has grown, the stroke gone once it is out), never a per-frame cost.
 */
export function draw() {
  if ( !canvas.ready || !canvas.scene ) return;
  const tl = timing(), t0 = tl ? performance.now() : 0;
  const all = [...strokes.values()]; if ( draft ) all.push(draft);
  const now = sharedNow(), still = reducedMotion(), g = geo();
  clearTimeout(phaseTimer); phaseTimer = 0;
  const next = M.nextChange(all, now, g, params, still);
  if ( Number.isFinite(next) ) phaseTimer = setTimeout(() => { phaseTimer = 0; draw(); }, Math.min(2 ** 31 - 1, Math.max(16, next - now + 20)));
  purge(now, g);
  const areas = shown() ? M.areasOf(all.sort(M.byOrder), g, params, now, still) : [];
  const t1 = tl ? performance.now() : 0;
  const has = areas.length > 0 || (shown() && extra.size > 0);
  if ( !has ) { if ( display ) { display.destroy(); display = null; } lastAreas = []; lastItems = []; fields.clear(); ready.clear(); return; }
  const keep = new Map(), items = [], used = new Set();
  const waiting = [];
  for ( const a of areas ) {
    let f = fields.get(a.key) ?? ready.get(a.key);
    if ( !f && (failed.has(a.key) || !request(a, g)) ) f = M.raster(a, g, params);
    if ( f ) { keep.set(a.key, f); items.push({ area: a, field: f }); } else waiting.push(a);
  }
  // an area whose field is still being computed shows what was there before (the previous field of the same place) meanwhile
  const shownIds = new Set(items.map((it) => it.area.id));
  for ( const a of waiting ) {
    let best = null, bo = 0;
    for ( const it of lastItems ) {
      if ( used.has(it) || shownIds.has(it.area.id) || it.area.id?.startsWith?.("x:") ) continue;
      const o = it.area.id === a.id ? Infinity : overlap(it.area.rect, a.rect);
      if ( o > bo ) { bo = o; best = it; }
    }
    if ( best ) { used.add(best); shownIds.add(best.area.id); items.push(best); }
  }
  for ( const k of ready.keys() ) if ( !keep.has(k) ) ready.delete(k);
  for ( const k of keep.keys() ) ready.delete(k);
  lastItems = items.slice();
  for ( const it of extra.values() ) items.push(it);
  fields = keep; lastAreas = areas;
  if ( !display && warming ) return;                                  // (the first display waits for the pre-warm: prewarm)
  display ??= new FireDisplay();
  const t2 = tl ? performance.now() : 0, b0 = tl ? display.stats.built : 0;
  display.sync(items, g, params);
  if ( tl ) { const t3 = performance.now(); tl.push({ draw: t3 - t0, areas: t1 - t0, sync: t3 - t2, n: areas.length, built: display.stats.built - b0, at: t0 }); }
}

/* ---------------------------------------------------------------- edits (GM) */

const sKey = (id) => `flags.${MODULE_ID}.${M.STROKES}.${id}`;
async function write(upd) {
  if ( !game.user.isGM || !canvas.scene ) return;
  try { await canvas.scene.update(upd); } catch ( err ) { console.warn(`${MODULE_ID} | fire: could not save`, err); }
}

/** A new stroke id: short, unique enough (time + random). */
export const newId = () => `f${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/**
 * A NEW stroke's footprint: an organic edge (e = 1) and, while the scene's torn edges are on, its tearing (tn) - pinned on the stroke
 * when it is painted (changing the scene's setting later changes only the strokes painted from then on, as destruction's torn borders).
 * `raw.tn` given (a macro): that, 0 = not torn.
 */
function fresh(raw) {
  if ( raw.k === "erase" ) return raw;
  const tn = raw.tn !== undefined ? Number(raw.tn) || 0 : params.torn ? params.tear : 0;
  const { tn: _t, ...rest } = raw;
  return { e: 1, ...rest, ...(tn > 0 ? { tn } : {}) };
}

/** The stroke being painted (the editor): shown at once, stored on `commit`. null clears it. */
let draftAt = 0, draftTimer = 0;
export function setDraft(st) {
  draft = st ? M.cleanStroke({ ...fresh(st), id: "draft", q: st.q ?? sharedNow() }) : null;
  if ( draft && !display ) prewarm();                                 // (a stroke begun before any warm-up: now - the tool usually did it)
  // (a big area takes ~25 ms to rasterize: while painting, at most ~12 redraws a second)
  clearTimeout(draftTimer);
  const wait = 80 - (performance.now() - draftAt);
  if ( !draft || wait <= 0 ) { draftAt = performance.now(); scheduleDraw(); }
  else draftTimer = setTimeout(() => { draftAt = performance.now(); scheduleDraw(); }, wait);
}

/** The GM removes the records of strokes whose going-out animation is over (one write; other clients already show them gone). */
function purge(now, g) {
  if ( !game.user.isGM || purging || !canvas.scene ) return;
  const gone = M.goneAt([...strokes.values()], now, g, params);
  if ( !gone.length ) return;
  for ( const s of gone ) strokes.delete(s.id);
  purging = true;
  write(Object.fromEntries(gone.map((s) => [`flags.${MODULE_ID}.${M.STROKES}.-=${s.id}`, null]))).finally(() => { purging = false; });
}

/**
 * A stroke as this layer stores it, not stored: cleaned, with the footprint a new stroke gets (an organic edge, the scene's torn edges -
 * `fresh`), its paint time and an id. For a writer that puts strokes into a scene update of its own (presets/write.mjs: one update
 * for a whole firing). null when it is not a stroke.
 */
export const prepare = (raw) => M.cleanStroke({ ...fresh(raw), q: raw.q ?? sharedNow(), id: raw.id && raw.id !== "draft" ? raw.id : newId() });

/**
 * Store MANY strokes in ONE write (GM): each as `add` makes it (prepare: the torn edges too), one undo step for all; `extra` more keys
 * for the same scene update. -> the stored strokes.
 */
export async function addMany(raws, { undoable = true, extra = null } = {}) {
  if ( !game.user.isGM ) return [];
  const list = (raws ?? []).map(prepare).filter(Boolean);
  if ( !list.length && !extra ) return [];
  for ( const st of list ) strokes.set(st.id, st);
  if ( undoable && list.length ) { undoStack.push({ add: list }); if ( undoStack.length > UNDO_MAX ) undoStack.shift(); redoStack.length = 0; }
  draw(); tell("edited");
  await write({ ...Object.fromEntries(list.map((st) => [sKey(st.id), st])), ...(extra ?? {}) });
  return list;
}

/** Store a stroke (one flag key). */
export function add(raw, { undoable = true } = {}) {
  const st = prepare(raw);
  if ( !st || !game.user.isGM ) return null;
  strokes.set(st.id, st); draft = null;
  if ( undoable ) { undoStack.push({ add: [st] }); if ( undoStack.length > UNDO_MAX ) undoStack.shift(); redoStack.length = 0; }
  draw(); tell("edited");
  write({ [sKey(st.id)]: st });
  return st;
}

/**
 * PUT OUT strokes by id (delete, clear, undo of a paint): each keeps its record with its out time `o` (one write) and goes out on
 * every client - the flames sink, the embers darken, the smoke drifts away - then the GM removes the records (`purge`).
 */
export function remove(ids, { undoable = true } = {}) {
  // (a stroke timed to go out later - a preset's - is put out now too; one not caught yet is dropped: model.putOutPlan)
  const now = Math.round(sharedNow());
  const { put, drop } = M.putOutPlan((Array.isArray(ids) ? ids : [ids]).map((id) => strokes.get(id)).filter(Boolean), now);
  if ( (!put.length && !drop.length) || !game.user.isGM ) return 0;
  if ( undoable ) { undoStack.push({ del: put, dropped: drop }); redoStack.length = 0; }
  if ( drop.length ) dropOut(drop, put.length ? null : true);
  if ( put.length ) putOut(put);
  return put.length + drop.length;
}
/** Strokes not caught yet taken away: their records deleted (`write` false: the caller writes; null: drawn, written with a put-out). */
function dropOut(list, alone = true) {
  for ( const s of list ) strokes.delete(s.id);
  const upd = Object.fromEntries(list.map((s) => [`flags.${MODULE_ID}.${M.STROKES}.-=${s.id}`, null]));
  if ( alone ) { draw(); tell("edited"); }
  write(upd);
}
/** Strokes dropped before they caught, given back as they were (an undo of their drop: they catch at their own time). */
function restore(list) {
  const upd = {};
  for ( const s of list ) { strokes.set(s.id, s); upd[sKey(s.id)] = s; }
  draw(); tell("edited");
  write(upd);
}
function putOut(list) {
  if ( !list.length ) return;
  const now = Math.round(sharedNow()), upd = {};
  for ( const s of list ) { const o = { ...s, o: now }; strokes.set(s.id, o); upd[sKey(s.id)] = o; }
  draw(); tell("edited");
  write(upd);
}
/** Bring strokes back (undo of a delete, redo of a paint): they keep their place in the paint order and grow again from now. */
function relight(list) {
  const now = Math.round(sharedNow()), upd = {};
  // (a scene update MERGES the stored object: the out time is deleted explicitly, or every other client would still see it out)
  for ( const s of list ) { const { o, ...rest } = s; const st = M.cleanStroke({ ...rest, g: now }); strokes.set(st.id, st); upd[sKey(st.id)] = st; upd[`${sKey(st.id)}.-=o`] = null; }
  draw(); tell("edited");
  write(upd);
}

/**
 * Change a stroke's fire / smoke level afterwards (the dock list, the API): one write. F1: a fire stroke's new level (1..3, steps of
 * 0.05) RAMPS from the level it shows now along a smoothstep over `over` ms (default model.LV_RAMP_MS; 0 = at once), starting
 * LV_LEAD_MS from now so every client gets the write before it begins; the smoke level changes at once.
 */
export function setLevels(id, { lv, sm, over } = {}) {
  const s = strokes.get(id); if ( !s || !game.user.isGM || !M.burningAt(s, sharedNow()) ) return null;
  const now = Math.round(sharedNow()), { l0: _a, lt: _b, lr: _c, ...rest } = s;
  const nlv = lv !== undefined && lv !== null ? M.cleanStroke({ ...s, lv }).lv : s.lv;
  const ms = over === undefined || over === null ? M.LV_RAMP_MS : Math.min(25000, Math.max(0, Number(over) || 0));
  const from = s.k === "fire" ? M.levelNow(s, now) : s.lv;
  const ramp = s.k === "fire" && Math.abs(nlv - from) > 1e-6 && ms > 0 ? { l0: from, lt: now + M.LV_LEAD_MS, lr: ms / 1000 }
    : s.k === "fire" && nlv === s.lv && s.l0 !== undefined && M.levelNow(s, now) !== s.lv ? { l0: s.l0, lt: s.lt, lr: s.lr } : {};   // (same level: a running ramp runs on)
  const st = M.cleanStroke({ ...rest, lv: nlv, ...(sm !== undefined ? { sm } : {}), ...ramp });
  strokes.set(id, st); draw(); tell("edited");
  const drop = {}; for ( const k of ["l0", "lt", "lr"] ) if ( s[k] !== undefined && st[k] === undefined ) drop[`${sKey(id)}.-=${k}`] = null;
  write({ [sKey(id)]: st, ...drop });
  return st;
}

/** Torn edges on (amount 0.1..1; true = the scene's tearing) or off (0 / false) for one stroke afterwards: one write, drawn again. */
export function setTorn(id, amount) {
  const s = strokes.get(id); if ( !s || s.k === "erase" || !game.user.isGM || !M.burningAt(s, sharedNow()) ) return null;
  const tn = amount === true ? params.tear : Number(amount) || 0;
  const { tn: _t, ...rest } = s;
  const st = M.cleanStroke(tn > 0 ? { ...rest, tn } : rest);
  strokes.set(id, st); draw(); tell("edited");
  write({ [sKey(id)]: st, ...(st.tn ? {} : { [`${sKey(id)}.-=tn`]: null }) });
  return st;
}

/** Change a stroke's fire colour afterwards ("#rrggbb", a preset name; null / "" = the scene's): one write, drawn again. */
export function setColor(id, color) {
  const s = strokes.get(id); if ( !s || s.k === "erase" || !game.user.isGM || !M.burningAt(s, sharedNow()) ) return null;
  const { c, ...rest } = s;
  const st = M.cleanStroke(color ? { ...rest, c: color } : rest);
  strokes.set(id, st); draw(); tell("edited");
  write({ [sKey(id)]: st, ...(st.c ? {} : { [`${sKey(id)}.-=c`]: null }) });   // (an update merges: back to the scene's colour = delete c)
  return st;
}

/** Every stroke the panel lists goes out (one undo step) - a preset's timed fire too (list / model.burningAt). */
export function clear() { return remove(list().map((s) => s.id)); }

/** Undo / redo of whole strokes, with the same animations: what comes back grows, what goes away goes out. */
function apply(step, back) {
  const addL = back ? step.del : step.add, delL = back ? step.add : step.del, now = sharedNow();
  if ( delL?.length ) putOut(delL.map((s) => strokes.get(s.id)).filter((s) => s && M.burningAt(s, now)));
  if ( addL?.length ) relight(addL);
  // (strokes dropped before they caught: given back as they were - or dropped again on a redo)
  if ( step.dropped?.length ) { if ( back ) restore(step.dropped); else dropOut(step.dropped.filter((s) => strokes.has(s.id))); }
}
export function undo() { const s = undoStack.pop(); if ( !s ) return false; redoStack.push(s); apply(s, true); return true; }
export function redo() { const s = redoStack.pop(); if ( !s ) return false; undoStack.push(s); apply(s, false); return true; }

/** Change the layer's settings (GM): stored in the scene flag; every client redraws. */
export function setParams(patch) {
  if ( !game.user.isGM ) return;
  params = M.cleanParams({ ...params, ...patch });
  fields.clear();   // (flame height, plume, smoke change the fields)
  draw(); tell("params");
  write({ [`flags.${MODULE_ID}.${M.FLAG}`]: { v: M.VERSION, ...params } });
}

/**
 * ANOTHER SOURCE of fire (the hook for a destruction stroke that burns, later): a field (model.fieldFromMask / fieldFrom) over a
 * rectangle of cells, shown by the same display with its own id. null removes it. Not stored: the caller computes it on every client.
 */
export function setExtra(id, area, field) {
  if ( !area || !field ) extra.delete(id); else extra.set(id, { area: { id: `x:${id}`, key: `x:${id}:${area.key ?? ""}`, seed: 1, wind: [0, 0], ...area }, field });
  scheduleDraw();
}

/* ---------------------------------------------------------------- the api */

export const fireApi = {
  /**
   * Paint a stroke from a macro: `points` = [[x, y], ...] or { x, y } (scene px); `kind` "fire" | "smoke" | "erase"; `radius` scene
   * px; `strength` 0.1..1; `wind` { dir (degrees, 0 = right, 90 = down), speed 0..1 }; `level` 1..3 (fire), `smoke` 0..3 (fire) /
   * 1..3 (smoke); `style` "fire" | "fireball"; `color` "#rrggbb" or a preset name (look.PRESETS; omitted: the scene's fire colour).
   * `torn`: true / an amount 0.1..1 / false (omitted: the scene's torn edges). `kind` "dust": ground DUST AND GRIT (dust-model.mjs),
   * `dust` "bike" | "car" | "drag" | "heavy" what passed along the path, `level` 1..3, `radius` the band's half-width. Returns the
   * stored stroke (or null).
   */
  paint(points, { kind = "fire", radius = 50, strength = 0.8, wind = null, level = 2, smoke = 2, style = "fire", color = null, torn = undefined, dust = "car", grow = undefined, out = undefined, at = undefined, debris = null } = {}) {
    const pts = Array.isArray(points) ? points : [[points.x, points.y]];
    const w = wind ?? { dir: game.settings.get(MODULE_ID, "fireWindDir"), speed: game.settings.get(MODULE_ID, "fireWind") };
    return add({ k: kind, r: radius, s: strength, p: pts.flatMap(([x, y]) => [x, y]), wd: w.dir ?? 0, ws: w.speed ?? 0, lv: level, sm: smoke, st: style, ...(color ? { c: color } : {}), ...(kind === "dust" ? { dk: dust } : {}),
      ...(torn === undefined ? {} : { tn: torn === true ? params.tear : Number(torn) || 0 }), ...(grow !== undefined ? { gr: grow } : {}), ...(out !== undefined ? { ot: out } : {}),
      ...(at !== undefined ? { q: at } : {}), ...(kind === "burst" && Array.isArray(debris) ? { db: debris.flat() } : {}) });
  },
  /**
   * An EXPLOSION (burst-model.mjs) at (x, y): `radius` the fireball's (scene px), `level` 1 grenade / 2 shell / 3 bomb, `at` the impact
   * (shared clock ms; omitted: now), `color`, `debris` [[dx, dy, ms], ...] burning chunks thrown to where they land. Returns the stroke.
   */
  burst(x, y, { radius = 100, level = 3, at = undefined, color = null, debris = null, wind = null } = {}) {
    return fireApi.paint([[x, y]], { kind: "burst", radius, level, at, color, debris, wind });
  },
  addMany: (raws, opts) => addMany(raws, opts), prepare,
  /** Torn edges for one stroke afterwards: true (the scene's tearing), an amount 0.1..1, or false. */
  setTorn: (id, amount) => setTorn(id, amount),
  /** Change a stroke's levels afterwards: `{ level, smoke, over }` - a fire level 1..3 (steps of 0.05) eases there over `over` ms (default 4000, 0 = at once). */
  setLevels: (id, { level, smoke, over } = {}) => setLevels(id, { lv: level, sm: smoke, over }),
  /** Change a stroke's fire colour afterwards ("#rrggbb", a preset name; null = the scene's). */
  setColor: (id, color) => setColor(id, color),
  /** The colour presets and the palette rule (look.mjs). */
  colors: () => ({ ...Look.PRESETS }), rampOf: (c) => Look.rampOf(c),
  erase(x, y, radius = 50) { return add({ k: "erase", r: radius, s: 1, p: [x, y] }); },
  remove: (id) => remove(id), clear, undo, redo,
  list: () => list().map((s) => ({ ...s, p: [...s.p] })),
  params: () => ({ ...params }), setParams,
  /** How it stands: strokes, areas, what is drawn, particles, lights, the last tick's ms. */
  status: () => ({ pending: running.size + queued.size + (display?.pending?.size ?? 0), adopting: display?.pending?.size ?? 0, strokes: strokes.size, out: [...strokes.values()].filter((s) => s.o !== undefined).length, animating: lastAreas.filter((a) => Object.values(a.phases ?? {}).some((p) => p !== "on")).length, areas: lastAreas.length, shown: shown(), on: params.on, who: params.who, ...(display?.stats ?? { visible: 0, particles: 0, lights: 0, tickMs: 0 }), display: !!display }),
  display: () => display,
  geo, setExtra, model: M
};

export function registerFire() {
  moduleApi.fire = fireApi;
  Hooks.on("canvasReady", onCanvasReady);
  Hooks.on("canvasTearDown", teardown);
  Hooks.on("updateScene", onUpdateScene);
  // the art grid follows the destruction layer's (its ap may arrive after the canvas is ready)
  Hooks.on("moinenMapsDestruction", (kind) => { if ( kind === "loaded" && strokes.size ) { const g = JSON.stringify(geo()); if ( display && JSON.stringify(display.geo) !== g ) { fields.clear(); draw(); } } });
  Hooks.on("moinenMapsPerfMode", () => display?.refresh());
  // (a token moved, appeared, went or changed size: its depth against the flames, recomputed once on the next frame)
  for ( const h of ["refreshToken", "createToken", "deleteToken"] ) Hooks.on(h, () => display?.tokensDirty());
  Hooks.once("ready", () => { const m = game.modules.get(MODULE_ID); if ( m ) { m.api ??= moduleApi; m.api.fire ??= fireApi; } });
}
