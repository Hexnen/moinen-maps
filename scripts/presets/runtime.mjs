import { MODULE_ID } from "../config.mjs";
import { sharedNow } from "../shared-clock.mjs";
import * as R from "./runtime-core.mjs";

/**
 * DESTRUCTION PRESETS, the firings runtime on EVERY client (P6 of dev/presets-design.md, G9; the pure rules in runtime-core.mjs).
 *  - From the scene's firing records (flags.presetFirings) and the shared clock, each client calls the hook `moinenMapsPresets` at
 *    the moments of a firing - the layers that play the parts no layer plays by itself (burst, dust kinds, accents, cues: P3-P5)
 *    listen to it:
 *      ("firing", { fid, rec, late })          a record is here (written now, or found on a scene load / late join; late = ms past T0)
 *      ("impact", { fid, rec, t })             its T0 (not after the fact)
 *      ("part", { fid, rec, part, i, item, t, late })   a pending part at its moment (late > 0: a running part handed over late)
 *      ("gone", { fid })                        its record went (undone, settled or purged): anything of it still playing stops
 *    The fire, smoke and dust strokes and the timed damage play by themselves (their own q / o / at).
 *  - PURGE: a record goes once everything it named is over (runtime-core purgeState) - one write, by the GM who fired it while they
 *    are here, else by the active GM (as the cinematic show's owner).
 *  - Nothing happens on a scene without firing records: the hooks below return at once (no ticker, no setting, no flag).
 */
export const FLAG = "presetFirings";
export const HOOK = "moinenMapsPresets";
const FIRE = "fireStrokes";

const timers = new Map();          // fid -> its pending timeouts
const known = new Set();           // fids this client has taken up on this scene
let purgeTimer = 0, purging = false;

export const recordsOf = (scene = canvas?.scene) => {
  const F = scene?.flags?.[MODULE_ID]?.[FLAG];
  return F && typeof F === "object" ? Object.values(F).filter((r) => r && typeof r === "object" && typeof r.id === "string") : [];
};
const firesOf = (scene = canvas?.scene) => scene?.flags?.[MODULE_ID]?.[FIRE] ?? {};
const recent = [];                 // the last calls (tests, debugging): [kind, fid, part, late]
const call = (kind, data) => {
  recent.push([kind, data.fid, data.part ?? null, data.late ?? null]); if ( recent.length > 40 ) recent.shift();
  try { Hooks.callAll(HOOK, kind, data); } catch ( err ) { console.warn(`${MODULE_ID} | presets: a ${kind} listener failed`, err); }
};

/** Take up a record on this client: its moments from now on (late joiners: what is still running, late). */
function take(rec) {
  if ( known.has(rec.id) ) return;
  known.add(rec.id);
  const now = sharedNow(), list = [];
  // (the damage it wrote draws at its impact: link the damage layer's programs now, in the background - load-warm.mjs warmDamage)
  if ( rec.t0 > now ) import("../load-warm.mjs").then((m) => m.warmDamage()).catch(() => {});
  call("firing", { fid: rec.id, rec, late: Math.max(0, Math.round(now - rec.t0)) });
  for ( const e of R.schedule(rec, now) ) {
    const go = () => {
      if ( !known.has(rec.id) ) return;
      if ( e.part === "impact" ) call("impact", { fid: rec.id, rec, t: e.t });
      else call("part", { fid: rec.id, rec, part: e.part, i: e.i, item: e.item, t: e.t, late: Math.max(0, Math.round(sharedNow() - e.t)) });
    };
    if ( e.wait <= 0 ) go(); else list.push(setTimeout(go, Math.min(2 ** 31 - 1, Math.ceil(e.wait))));
  }
  timers.set(rec.id, list);
}
function drop(fid) {
  for ( const t of timers.get(fid) ?? [] ) clearTimeout(t);
  timers.delete(fid);
  if ( known.delete(fid) ) call("gone", { fid });
}
function sync(scene) {
  const recs = recordsOf(scene), ids = new Set(recs.map((r) => r.id));
  for ( const fid of [...known] ) if ( !ids.has(fid) ) drop(fid);
  for ( const r of recs.sort((a, b) => (a.t0 ?? 0) - (b.t0 ?? 0)) ) take(r);
}
function reset() {
  for ( const fid of [...timers.keys()] ) { for ( const t of timers.get(fid) ) clearTimeout(t); }
  timers.clear(); known.clear(); recent.length = 0;
  clearTimeout(purgeTimer); purgeTimer = 0;
}

/* ---------------------------------------------------------------- purge (the firing's GM, else the active GM) */

const purger = () => !!game.user?.isGM;
/** Does this client write the purge of record `r`? Its GM while they are connected, else the active GM. */
const owns = (r) => {
  const by = typeof r?.by === "string" ? game.users?.get?.(r.by) : null;
  return by?.active && by.isGM ? by.id === game.user.id : !!game.users?.activeGM?.isSelf;
};
function schedulePurge(ms = 0) {
  if ( !purger() ) return;
  clearTimeout(purgeTimer);
  purgeTimer = setTimeout(purge, Math.max(0, Math.min(2 ** 31 - 1, ms)));
}
async function purge() {
  purgeTimer = 0;
  const scene = canvas?.scene;
  if ( !scene || !purger() ) return;
  if ( purging ) return schedulePurge(1000);
  const now = sharedNow(), fires = firesOf(scene), upd = {};
  let next = Infinity;
  for ( const r of recordsOf(scene) ) {
    if ( !owns(r) ) continue;
    const st = R.purgeState(r, fires, now);
    if ( st.done ) upd[`flags.${MODULE_ID}.${FLAG}.-=${r.id}`] = null;
    else if ( st.next !== null ) next = Math.min(next, st.next);
  }
  if ( Object.keys(upd).length ) {
    purging = true;
    try { await scene.update(upd); } catch ( err ) { console.warn(`${MODULE_ID} | presets: purge`, err); } finally { purging = false; }
  }
  if ( Number.isFinite(next) ) schedulePurge(next - now + 50);
}

/* ---------------------------------------------------------------- wiring */

function onUpdateScene(scene, changed) {
  if ( scene.id !== canvas?.scene?.id ) return;
  const f = changed?.flags?.[MODULE_ID]; if ( !f ) return;
  const recs = FLAG in f || `-=${FLAG}` in f;
  if ( recs ) sync(scene);
  if ( (recs || FIRE in f || `-=${FIRE}` in f) && (recs || known.size) ) schedulePurge(250);
}
function onCanvasReady() {
  reset();
  const scene = canvas?.scene;
  if ( !recordsOf(scene).length ) return;
  sync(scene);
  schedulePurge(1000);
}

export function registerRuntime() {
  Hooks.on("canvasReady", onCanvasReady);
  Hooks.on("canvasTearDown", reset);
  Hooks.on("updateScene", onUpdateScene);
  // (another GM left: the purge falls to this one)
  Hooks.on("userConnected", () => { if ( known.size ) schedulePurge(1000); });
}

/** Tests / the API: what this client has taken up. */
export const status = () => ({ known: [...known], timers: [...timers.values()].reduce((a, l) => a + l.length, 0), purgeArmed: !!purgeTimer, recent: recent.map((r) => [...r]) });
