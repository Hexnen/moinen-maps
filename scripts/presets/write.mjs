import { MODULE_ID } from "../config.mjs";
import { sharedNow } from "../shared-clock.mjs";
import * as Core from "./core.mjs";
import * as DModel from "../destruction/model.mjs";
import * as D from "../destruction/destruction.mjs";
import * as FModel from "../fire/model.mjs";
import { newId as fireId } from "../fire/fire.mjs";

/**
 * DESTRUCTION PRESETS, the GM's writer (P1 of dev/presets-design.md): one firing = the plan of core.mjs written into the layers that
 * exist today, and its FIRING RECORD.
 *  - FIRE AND SMOKE strokes: complete fire-layer records with their times on the shared clock (q: they catch then; o: they go out
 *    then, absent = they burn until the GM puts them out) - written in ONE scene update together with the firing record; every client
 *    (this one too) takes them from the flag (fire.mjs onUpdateScene), nothing else is sent.
 *  - DESTRUCTION strokes: painted at once through the layer's paint API (destruction.mjs paintStroke: the bake, the chunks for the
 *    players) and saved at once, each with its entry start on the shared clock (`at` = T0 + its offset) and its firing (`ps`). Every
 *    client (this one too) holds the stroke off the screen until just before `at` and starts its entry then (timed-core.mjs), so the
 *    craters open at the impact everywhere, the hits of a gun in their own order. Their ids are chosen here, so the firing record
 *    names them from the start.
 *  - The firing record `flags.moinen-maps.presetFirings.<id>`: the preset, T0, the seed, the gesture, the ids per layer and the
 *    PENDING parts (burst, dust kinds, accents, cues) that their tasks will play (P3-P5). Nothing reads it yet but the API.
 *  - UNDO of a firing (undo): its damage dissolves out on every client (destruction.mjs removeStrokes; the brush's own undo skips a
 *    preset's strokes), its fire and smoke go out on their own from now (one that has not caught yet is dropped), the record goes.
 * Nothing here runs unless a firing is asked for (api.presets.fire): no hook, no setting, no ticker.
 */
export const FLAG = "presetFirings";

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
  upd[`flags.${MODULE_ID}.${FLAG}.${fid}`] = {
    id: fid, v: plan.v, preset: plan.preset, t0: plan.t0, seed: plan.seed, size: plan.size, power: plan.power, aftermath: plan.aftermath,
    at: plan.at, dir: plan.dir, gesture: plan.gesture, walk: plan.walk, by: game.user.id,
    d: plan.destruction.map((r, i) => ({ id: dIds[i], key: r.key })), f: fStrokes.map((s, i) => ({ id: s.id, key: plan.fire[i]?.key })),
    pending: plan.pending
  };
  await scene.update(upd);
  // the damage: painted now, each stroke timed (its `at`): every client holds it until just before then; written at once, so the
  // players have the strokes (and soon the chunks) during the pre-roll
  if ( plan.destruction.length && canvas.scene === scene ) {
    plan.destruction.forEach((rec, i) => D.paintStroke(paintSpec(rec, dIds[i], fid, plan.t0)));
    await D.save();
  }
  return { id: fid, plan };
}

/** The scene's firing records (newest first). */
export function firings(scene = canvas.scene) {
  const F = scene?.flags?.[MODULE_ID]?.[FLAG] ?? {};
  return Object.values(F).filter((r) => r && typeof r === "object" && r.id).sort((a, b) => (b.t0 ?? 0) - (a.t0 ?? 0));
}

/**
 * Take a firing back (GM): its damage dissolves out (destruction.mjs removeStrokes), its fire and smoke go out from now on with their
 * own going-out (`o` = now; one that has not caught yet is dropped), its record goes. -> true when there was such a firing.
 */
export async function undo(fid, scene = canvas.scene) {
  if ( !game.user.isGM || !scene ) return false;
  const F = scene.flags?.[MODULE_ID] ?? {}, rec = F[FLAG]?.[fid];
  if ( !rec || typeof rec !== "object" ) return false;
  const now = Math.round(sharedNow()), upd = {}, fs = F[FModel.STROKES] ?? {};
  for ( const q of Array.isArray(rec.f) ? rec.f : [] ) {
    const st = fs[q?.id]; if ( !st ) continue;
    if ( Number(st.q) > now ) upd[`flags.${MODULE_ID}.${FModel.STROKES}.-=${q.id}`] = null;
    else if ( !(Number(st.o) <= now) ) upd[`flags.${MODULE_ID}.${FModel.STROKES}.${q.id}.o`] = now;
  }
  upd[`flags.${MODULE_ID}.${FLAG}.-=${fid}`] = null;
  await scene.update(upd);
  if ( canvas.scene === scene && D.removeStrokes((rec.d ?? []).map((q) => q?.id).filter(Boolean)) ) await D.save();
  return true;
}
