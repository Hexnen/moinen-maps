import { equal, addDeletion, safeKey } from "./flag-diff.mjs";

/**
 * How the districts of a scene are stored. Two GMs painting at once used to lose strokes: the whole list was one array flag and a save
 * replaced it (the last writer won). Now every district is a key of its own, `flags.moinen-maps.districtsById.<id>` = the district plus
 * `s`, its place in the order, and a save writes only the districts that differ from what the editor READ (its base), so another GM's
 * edit to another district survives. Two edits of the SAME district still go to the last writer (its rings are one polygon set).
 * A scene from before keeps its array `districts` until the first save, which writes every district to its key and deletes the array.
 * Pure (no Foundry needed except the deletion operator); node-tested in dev/districts-merge.test.mjs.
 */
export const LEGACY = "districts";
export const MAP = "districtsById";

const bySeq = (a, b) => (a.s - b.s) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const valid = (d) => d && typeof d === "object" && typeof d.id === "string" && d.id;
const strip = ({ s, ...d }) => d;

/** The districts of a scene (`F`: its module flags), in order, shallow copies without `s` (clone before editing). Per-district keys first, then any the array still has. */
export function listOf(F) {
  const map = F?.[MAP] && typeof F[MAP] === "object" ? F[MAP] : null;
  const arr = Array.isArray(F?.[LEGACY]) ? F[LEGACY].filter(valid) : [];
  const keyed = map ? Object.values(map).filter(valid).map((d) => ({ ...d, s: Number.isFinite(d.s) ? d.s : 0 })).sort(bySeq) : [];
  if ( !keyed.length ) return arr;
  const have = new Set(keyed.map((d) => d.id));
  const out = keyed.map(strip);
  for ( const d of arr ) if ( !have.has(d.id) ) out.push(d);       // (written by a tab that still runs the array code)
  return out;
}

/**
 * The scene update that saves `list`. `base`: the list the editor started from (what it read; null: the scene as it is now). Only the
 * districts that differ from the base are written (a new one, a changed one, a new place `s`), only the ones the base had and the list
 * lacks are deleted; a district another GM added or changed meanwhile is never touched. The legacy array is removed with the first save.
 */
export function updateFor(F, list, base, prefix) {
  const upd = {}, stored = F?.[MAP] && typeof F[MAP] === "object" ? F[MAP] : {}, legacy = Array.isArray(F?.[LEGACY]);
  const from = base ?? listOf(F);
  const was = new Map(from.map((d, i) => [d.id, { ...d, s: i }]));
  const ids = new Set();
  list.forEach((d, i) => {
    if ( !safeKey(d.id) ) { console.error("moinen-maps | a district id is not usable as a flag key, not saved", d.id); return; }
    ids.add(d.id);
    const next = { ...d, s: i }, prev = was.get(d.id);
    // (no base entry, or a base that differs from the list: write; a district that is unchanged against the base is left alone)
    if ( !prev || !equal(prev, next) || (legacy && !(d.id in stored)) ) upd[`${prefix}.${MAP}.${d.id}`] = next;
  });
  for ( const id of was.keys() ) if ( !ids.has(id) && (id in stored) ) addDeletion(upd, `${prefix}.${MAP}.${id}`);
  if ( legacy ) {
    // the first save in the new layout: every district the array held that this save keeps is already written above (it is not in
    // `stored`); the array goes
    addDeletion(upd, `${prefix}.${LEGACY}`);
  }
  return upd;
}

/** The update that sets some fields of one district (the attribute publisher: only `attrs`), in whichever layout the scene has. */
export function patchFor(F, id, patch, prefix) {
  const upd = {};
  if ( F?.[MAP]?.[id] ) { for ( const [k, v] of Object.entries(patch) ) upd[`${prefix}.${MAP}.${id}.${k}`] = v; return upd; }
  const arr = Array.isArray(F?.[LEGACY]) ? structuredClone(F[LEGACY]) : null;
  const cur = arr?.find((d) => d.id === id);
  if ( !cur ) return upd;
  Object.assign(cur, patch);
  upd[`${prefix}.${LEGACY}`] = arr;
  return upd;
}
