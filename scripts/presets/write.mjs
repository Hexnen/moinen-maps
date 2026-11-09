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
 *  - DESTRUCTION strokes: through the brush's own entry (destruction.mjs edited: the bake, the save, the chunks for the players), a
 *    moment before the impact (LEAD ms), so the crater enters about at T0 here and soon after on the players' screens. The entry start
 *    stored with the stroke on the shared clock (`at`) is P2's: until then this lead is the stand-in. Their ids are chosen here, so
 *    the firing record names them from the start.
 *  - The firing record `flags.moinen-maps.presetFirings.<id>`: the preset, T0, the seed, the gesture, the ids per layer and the
 *    PENDING parts (burst, dust kinds, accents, cues) that their tasks will play (P3-P5). Nothing reads it yet but the API.
 * Nothing here runs unless a firing is asked for (api.presets.fire): no hook, no setting, no ticker.
 */
export const FLAG = "presetFirings";
/** How long before T0 the destruction strokes are handed to the brush (ms): about the GM's bake time (dev/presets-design.md 3). */
const LEAD = () => globalThis.CONFIG?.moinenMaps?.presetLead ?? 350;
const pending = new Map();           // firing id -> timer of its destruction strokes (a scene change cancels them)

const T = (k) => game.i18n.localize(`MOINENMAPS.${k}`);

/** The world a firing is expanded in. */
export function envOf(scene = canvas.scene) {
  const r = DModel.sceneRect(scene);
  let dir = 0, speed = 0;
  try { dir = game.settings.get(MODULE_ID, "fireWindDir"); speed = game.settings.get(MODULE_ID, "fireWind"); } catch { /* not registered */ }
  return { grid: canvas.grid?.size ?? 100, rect: { x: r.x, y: r.y, width: r.width, height: r.height }, now: Math.round(sharedNow()), wind: { dir, speed } };
}

/** A destruction record of the plan -> the brush's stroke: its discs stamped into a full-grid buffer. */
function strokeOf(rec, S, id) {
  const buf = { mask: new Uint8Array(S.mw * S.mh), mw: S.mw, mh: S.mh, mpx: S.mpx };
  const type = Math.max(0, DModel.TYPES.indexOf(rec.type));
  let box = null;
  for ( const [x, y, r, lv] of rec.discs ) {
    const b = DModel.stamp(buf, x, y, r, { mode: "raise", level: lv, type });
    if ( b ) box = box ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) } : b;
  }
  if ( !box ) return null;
  const pt = (p) => ({ x: p[0], y: p[1] });
  return { box, stroke: { id, buf: buf.mask, erase: false, type, cause: DModel.causeOf(rec.cause), a: pt(rec.a), b: rec.b ? pt(rec.b) : null,
    path: rec.path ?? null, keepPath: !!rec.path, pr: rec.pr ?? undefined } };
}

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
  // the damage: handed to the brush LEAD ms before T0 (its bake takes about that long here; the players' chunks follow)
  const wait = Math.max(0, plan.t0 - LEAD() - sharedNow());
  const go = () => {
    pending.delete(fid);
    if ( canvas.scene !== scene ) return;
    plan.destruction.forEach((rec, i) => { const s = strokeOf(rec, D.ensureState(), dIds[i]); if ( s ) D.edited(s.box, s.stroke); });
  };
  if ( plan.destruction.length ) {
    if ( wait > 0 ) { pending.set(fid, setTimeout(go, wait)); Hooks.once("canvasTearDown", cancelPending); } else go();
  }
  return { id: fid, plan };
}

/** The scene's firing records (newest first). */
export function firings(scene = canvas.scene) {
  const F = scene?.flags?.[MODULE_ID]?.[FLAG] ?? {};
  return Object.values(F).filter((r) => r && typeof r === "object" && r.id).sort((a, b) => (b.t0 ?? 0) - (a.t0 ?? 0));
}

/** A scene change: destruction strokes still waiting for their moment are dropped (the firing record says what was planned). */
export function cancelPending() { for ( const t of pending.values() ) clearTimeout(t); pending.clear(); }
