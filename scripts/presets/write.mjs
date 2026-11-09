import { MODULE_ID } from "../config.mjs";
import { sharedNow } from "../shared-clock.mjs";
import * as Core from "./core.mjs";
import * as DModel from "../destruction/model.mjs";
import * as D from "../destruction/destruction.mjs";
import * as FModel from "../fire/model.mjs";
import { newId as fireId } from "../fire/fire.mjs";
import * as R from "./runtime-core.mjs";

/**
 * DESTRUCTION PRESETS, the GM's writer (P1 / P6 of dev/presets-design.md): one firing = the plan of core.mjs written into the layers
 * that exist today, and its FIRING RECORD, all in ONE scene update (destruction.mjs save(extra)).
 *  - FIRE AND SMOKE strokes: complete fire-layer records with their times on the shared clock (q: they catch then; o: they go out
 *    then, absent = they burn until the GM puts them out); every client (this one too) takes them from the flag (fire.mjs
 *    onUpdateScene), nothing else is sent.
 *  - DESTRUCTION strokes: painted at once through the layer's paint API (destruction.mjs paintStroke: the bake, the chunks for the
 *    players), each with its entry start on the shared clock (`at` = T0 + its offset) and its firing (`ps`). Every
 *    client (this one too) holds the stroke off the screen until just before `at` and starts its entry then (timed-core.mjs), so the
 *    craters open at the impact everywhere, the hits of a gun in their own order. Their ids are chosen here, so the firing record
 *    names them from the start.
 *  - The firing record `flags.moinen-maps.presetFirings.<id>`: the preset, T0, the seed, the gesture, the ids per layer and the
 *    PENDING parts (burst, dust kinds, accents, cues) that their tasks will play (P3-P5); every client times them (runtime.mjs).
 *  - UNDO of a firing (undo): its damage dissolves out on every client (destruction.mjs removeStrokes; the brush's own undo skips a
 *    preset's strokes), its fire and smoke go out on their own from now (one that has not caught yet is dropped), the record goes.
 *    REDO fires it again (same seed, new T0). SETTLE drops a record early; clearFires puts out the timed aftermath fires.
 * Nothing here runs unless a firing is asked for (api.presets.fire): no hook, no setting, no ticker.
 */
export const FLAG = "presetFirings";

/**
 * The GM's preset UNDO / REDO (per scene, this client's session - as the layers' own undo): an entry keeps what is needed to take a
 * firing back after its record was purged (the ids it wrote) and to fire it again (definition, gesture, options with its seed).
 */
const undoStack = [], redoStack = [];
const STACK_MAX = 50;

const T = (k) => game.i18n.localize(`MOINENMAPS.${k}`);

/** The world a firing is expanded in. */
export function envOf(scene = canvas.scene) {
  const r = DModel.sceneRect(scene);
  let dir = 0, speed = 0;
  try { dir = game.settings.get(MODULE_ID, "fireWindDir"); speed = game.settings.get(MODULE_ID, "fireWind"); } catch { /* not registered */ }
  return { grid: canvas.grid?.size ?? 100, rect: { x: r.x, y: r.y, width: r.width, height: r.height }, now: Math.round(sharedNow()), wind: { dir, speed } };
}

/** A destruction record of the plan -> the layer's paint call (destruction.mjs paintStroke): timed at T0 + its offset, owned by the firing. */
export const paintSpec = (rec, id, fid, t0) => ({ id, discs: rec.discs, type: rec.type, cause: DModel.causeOf(rec.cause), path: rec.path ?? null,
  pr: rec.pr ?? null, a: rec.a, b: rec.b ?? null, at: Math.round(t0 + (rec.at ?? 0)), ps: fid });

/**
 * Fire a preset (GM): `def` a definition (core.mjs format) or a built-in's id, `gesture` { a, b?, from? } (scene px), `opts`
 * { seed, size, power, aftermath (seconds | null = no end | undefined = the preset's) }. Returns { id, plan } or null.
 */
export async function fire(def, gesture, opts = {}) {
  if ( !game.user.isGM ) { ui.notifications?.warn(T("DPreset.gmOnly")); return null; }
  const scene = canvas.scene;
  if ( !scene ) return null;
  if ( !game.modules.get(MODULE_ID)?.api?.destruction ) { ui.notifications?.warn(T("DPreset.noDestruction")); return null; }
  const seed = Number.isFinite(opts.seed) ? opts.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
  const plan = Core.expand(def, gesture, { ...opts, seed }, envOf(scene));
  const fid = foundry.utils.randomID(12);
  D.ensureState();
  // ids first: the record names every stroke from the start
  const dIds = plan.destruction.map(() => foundry.utils.randomID(10));
  const fStrokes = [];
  for ( const rec of plan.fire ) {
    const { key, ...raw } = rec;
    const st = FModel.cleanStroke({ ...raw, id: fireId() });
    if ( st ) fStrokes.push(st);
  }
  const upd = {};
  for ( const st of fStrokes ) upd[`flags.${MODULE_ID}.${FModel.STROKES}.${st.id}`] = st;
  const record = {
    id: fid, v: plan.v, preset: plan.preset, t0: plan.t0, seed: plan.seed, size: plan.size, power: plan.power, aftermath: plan.aftermath,
    at: plan.at, dir: plan.dir, gesture: plan.gesture, walk: plan.walk, by: game.user.id,
    d: plan.destruction.map((r, i) => ({ id: dIds[i], key: r.key, at: Math.round(plan.t0 + (r.at ?? 0)) })), f: fStrokes.map((s, i) => ({ id: s.id, key: plan.fire[i]?.key })),
    pending: plan.pending
  };
  upd[`flags.${MODULE_ID}.${FLAG}.${fid}`] = record;
  // ONE update: the damage (painted now, each stroke timed by its `at`: every client holds it until just before then), the fire and
  // smoke strokes and the record - the players get all of it together, during the pre-roll
  plan.destruction.forEach((rec, i) => D.paintStroke(paintSpec(rec, dIds[i], fid, plan.t0)));
  if ( canvas.scene !== scene ) return null;
  await D.save(upd);
  if ( !redoing ) redoStack.length = 0;
  undoStack.push({ fid, scene: scene.id, def, gesture, opts: { ...opts, seed }, rec: structuredClone(record) });
  if ( undoStack.length > STACK_MAX ) undoStack.shift();
  return { id: fid, plan };
}
let redoing = false;

/** The scene's firing records (newest first). */
export function firings(scene = canvas.scene) {
  const F = scene?.flags?.[MODULE_ID]?.[FLAG] ?? {};
  return Object.values(F).filter((r) => r && typeof r === "object" && r.id).sort((a, b) => (b.t0 ?? 0) - (a.t0 ?? 0));
}

/** The fire-layer keys that put strokes out from `now` (`put`) or drop them (`drop`, not caught yet). */
function fireOut({ put, drop }, now) {
  const upd = {};
  for ( const id of drop ) upd[`flags.${MODULE_ID}.${FModel.STROKES}.-=${id}`] = null;
  for ( const id of put ) upd[`flags.${MODULE_ID}.${FModel.STROKES}.${id}.o`] = now;
  return upd;
}

/**
 * Take a firing back (GM; `fid` omitted: this GM's last firing on the scene): its damage dissolves out (destruction.mjs removeStrokes),
 * its fire and smoke go out from now with their own going-out (one that has not caught yet is dropped), its record goes - ONE
 * update. A firing whose record was purged is still taken back from the undo entry (the ids it wrote). -> true when it was.
 */
export async function undo(fid = null, scene = canvas.scene) {
  if ( !game.user.isGM || !scene || canvas.scene !== scene ) return false;
  const k = fid ? undoStack.findLastIndex((e) => e.fid === fid && e.scene === scene.id) : undoStack.findLastIndex((e) => e.scene === scene.id);
  const F = scene.flags?.[MODULE_ID] ?? {}, live = F[FLAG]?.[fid ?? undoStack[k]?.fid];
  const rec = live && typeof live === "object" ? live : undoStack[k]?.rec;
  if ( !rec ) return false;
  const now = Math.round(sharedNow());
  const upd = fireOut(R.undoFires(rec, F[FModel.STROKES], now), now);
  if ( live ) upd[`flags.${MODULE_ID}.${FLAG}.-=${rec.id}`] = null;
  D.ensureState();
  const n = D.removeStrokes((rec.d ?? []).map((q) => q?.id).filter(Boolean));
  if ( n || Object.keys(upd).length ) await D.save(upd);
  if ( k >= 0 ) redoStack.push(undoStack.splice(k, 1)[0]);
  return true;
}

/** Redo (GM): the last firing taken back is fired again - the same preset, gesture and seed, a new T0 (it plays again). -> { id, plan } | null. */
export async function redo(scene = canvas.scene) {
  if ( !game.user.isGM || !scene ) return null;
  const k = redoStack.findLastIndex((e) => e.scene === scene.id);
  if ( k < 0 ) return null;
  const e = redoStack.splice(k, 1)[0];
  redoing = true;
  try { return await fire(e.def, e.gesture, e.opts); } finally { redoing = false; }
}

/** Settle a firing (GM): its record goes now - what it put down stays and plays out by itself; its cues and accents still to come are dropped (every client: "gone"). */
export async function settle(fid, scene = canvas.scene) {
  if ( !game.user.isGM || !scene?.flags?.[MODULE_ID]?.[FLAG]?.[fid] ) return false;
  await scene.update({ [`flags.${MODULE_ID}.${FLAG}.-=${fid}`]: null });
  return true;
}

/**
 * Put out the fire and smoke of the scene's firings that are timed to go out (GM): the fire layer's clear() reaches only strokes
 * without an out time, so a preset's timed aftermath would burn on - one update. -> how many.
 */
export async function clearFires(scene = canvas.scene) {
  if ( !game.user.isGM || !scene ) return 0;
  const now = Math.round(sharedNow()), F = scene.flags?.[MODULE_ID] ?? {};
  const recs = Object.values(F[FLAG] ?? {}).filter((r) => r && typeof r === "object" && r.id);
  const timed = R.burning(recs, F[FModel.STROKES], now).filter((s) => s.o !== null);
  const upd = fireOut({ put: timed.filter((s) => !(s.q > now)).map((s) => s.id), drop: timed.filter((s) => s.q > now).map((s) => s.id) }, now);
  if ( !Object.keys(upd).length ) return 0;
  await scene.update(upd);
  return timed.length;
}

/** Tests: the undo / redo stacks (fid, scene). */
export const stacks = () => ({ undo: undoStack.map((e) => [e.fid, e.scene]), redo: redoStack.map((e) => [e.fid, e.scene]) });
