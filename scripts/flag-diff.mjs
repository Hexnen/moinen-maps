/**
 * Incremental flag writes: a scene update that names only the keys whose value really changed (dot-notation keys, one per stroke or
 * per mask), deletions as Foundry v14's ForcedDeletion operator (the "-=" key syntax still works there but logs a deprecation; it is
 * the fallback where the operator is missing). An update that would change nothing is empty: the caller skips the write.
 * Pure (no Foundry needed except for the deletion operator), node-tested in dev/flag-layout.test.mjs.
 */

/** Deep equality of JSON-like values; null and a missing value count as the same (a stored null field is "not set"). */
export function equal(a, b) {
  if ( a === b ) return true;
  if ( a == null || b == null ) return a == null && b == null;
  if ( typeof a !== "object" || typeof b !== "object" ) return false;
  if ( Array.isArray(a) !== Array.isArray(b) ) return false;
  if ( Array.isArray(a) ) {
    if ( a.length !== b.length ) return false;
    for ( let i = 0; i < a.length; i++ ) if ( !equal(a[i], b[i]) ) return false;
    return true;
  }
  const ka = Object.keys(a).filter((k) => a[k] != null), kb = Object.keys(b).filter((k) => b[k] != null);
  if ( ka.length !== kb.length ) return false;
  for ( const k of ka ) if ( !equal(a[k], b[k]) ) return false;
  return true;
}

/** Add a deletion of `key` (a full dot path) to the update. */
export function addDeletion(upd, key) {
  const Del = globalThis.foundry?.data?.operators?.ForcedDeletion;
  if ( Del ) upd[key] = new Del();
  else upd[key.replace(/\.([^.]+)$/, ".-=$1")] = null;
}

const plain = (v) => !!v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

/**
 * The value to write over `stored` so the result is exactly `next`. A scene update MERGES an object into the stored one (key by key,
 * at every depth): a key `next` no longer has would stay on the scene - the live view drops it, a reload (or another client) brings it
 * back. So every such key, at any depth, goes into the written copy as a deletion. Arrays and other values replace as they are.
 */
export function replacing(stored, next) {
  if ( !plain(next) ) return next;
  const out = {};
  for ( const [k, v] of Object.entries(next) ) if ( v !== undefined ) out[k] = replacing(plain(stored) ? stored[k] : undefined, v);
  if ( !plain(stored) ) return out;
  const Del = globalThis.foundry?.data?.operators?.ForcedDeletion;
  for ( const k of Object.keys(stored) ) {
    if ( k in out || stored[k] === undefined ) continue;
    if ( Del ) out[k] = new Del();
    else out[`-=${k}`] = null;
  }
  return out;
}

/** Write `next` at the full dot path `key` over the stored value `stored` (replacing: nothing of `stored` that `next` lacks survives). */
export function put(upd, key, stored, next) { upd[key] = replacing(stored, next); return upd; }

/** Set `prefix.k` for every key of `keys` whose value in `next` differs from `stored`. */
export function setChanged(upd, prefix, stored, next, keys = Object.keys(next)) {
  for ( const k of keys ) if ( !equal(stored?.[k], next[k]) ) upd[`${prefix}.${k}`] = replacing(stored?.[k], next[k] ?? null);
  return upd;
}

/** Make the stored map `prefix` equal `next` key by key: changed entries are written, entries no longer in `next` are deleted. */
export function syncMap(upd, prefix, stored, next) {
  const old = stored && typeof stored === "object" ? stored : {};
  for ( const [id, v] of Object.entries(next) ) if ( !equal(old[id], v) ) upd[`${prefix}.${id}`] = replacing(old[id], v);
  for ( const id of Object.keys(old) ) if ( !(id in next) && old[id] != null ) addDeletion(upd, `${prefix}.${id}`);
  return upd;
}

/** Is the key a valid single flag key (no dots, no operator prefix)? Stroke ids are. */
export const safeKey = (k) => typeof k === "string" && /^[A-Za-z0-9_]+$/.test(k);
