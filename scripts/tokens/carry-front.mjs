/**
 * THE CARRIED TOKEN IS ALWAYS IN FRONT (runtime). From the press that grabs a token (the editor, "grab") through the whole carry (tokens/carry.mjs,
 * "carry:<stroke>": lift-off, travel, landing, the hand-over of the document position, on every client and for a replay) and a moment after
 * (until the entry has settled), the token's mesh holds the keys the pure rule gives it (carry-core frontKeys: its own elevation, never a sortLayer
 * below the tokens' own, so every layer of the destruction - the ruin / cover / base quads, shards, GPU pieces, debris, dust, accents, cause
 * fx, water, the static cache bands and composite tiles, the glow, the tremor patch - sorts under it), and the editor's hatch overlay and brush
 * cursor (which live on the interface, above every mesh) go just under the tokens (editor.underTokens, registered with onUnder).
 *
 * Foundry resets a mesh's keys in its own refresh, so they are re-applied in the `refreshToken` hook (onRefresh). Nothing runs while no token is held (one Map lookup per token refresh).
 */
import { frontKeys } from "./carry-core.mjs";

const HOLDS = new Map();       // token id -> Set of tags
const PENDING = new Map();     // `${id}|${tag}` -> { id, tag, until } a release that waits (animation time: the carry's own clock, so a frozen test clock holds it too)
let ticking = false;
let underFn = () => {};
let isUnder = false;

/** The editor registers how its overlay and cursor go under the tokens (and back). */
export function onUnder(fn) { underFn = typeof fn === "function" ? fn : () => {}; }
function setUnder(on) { if ( on === isUnder ) return; isUnder = on; try { underFn(on); } catch ( err ) { console.warn("moinen-maps | carry front", err); } }

/** Give a token's mesh the keys it needs now (the document is never touched). */
export function enforce(token) {
  const m = token?.mesh; if ( !m || m.destroyed ) return false;
  const k = frontKeys(m);
  if ( m.sortLayer !== k.sortLayer ) { m.sortLayer = k.sortLayer; if ( canvas.primary ) canvas.primary.sortDirty = true; }
  return true;
}

/** Hold a token in front under `tag` (an id of whoever holds it). */
export function hold(id, tag) {
  if ( !id ) return;
  let s = HOLDS.get(id); if ( !s ) HOLDS.set(id, s = new Set());
  s.add(tag); PENDING.delete(`${id}|${tag}`);
  enforce(canvas?.tokens?.get(id));
  setUnder(true);
}

function drop(id, tag) {
  const s = HOLDS.get(id); if ( !s ) return;
  s.delete(tag);
  if ( s.size ) return;
  HOLDS.delete(id);
  if ( !HOLDS.size ) setUnder(false);
}

function tick() {
  const now = performance.now();
  for ( const [k, p] of [...PENDING] ) if ( now >= p.until && (now >= p.cap || !p.live?.()) ) { PENDING.delete(k); drop(p.id, p.tag); }
  if ( !PENDING.size ) stopTick();
}
function stopTick() { if ( ticking ) { canvas?.app?.ticker?.remove(tick); ticking = false; } }

/**
 * Let go of a hold, now or after `after` ms and, while `live()` says the entry still runs, no sooner (at most MAX_WAIT_MS more: the entry
 * settles after the token has landed). A newer hold of the same tag cancels a waiting release.
 */
export const MAX_WAIT_MS = 8000;
export function release(id, tag, after = 0, live = null) {
  if ( !id ) return;
  const key = `${id}|${tag}`;
  PENDING.delete(key);
  if ( after > 0 && canvas?.app?.ticker ) {
    const now = performance.now(); PENDING.set(key, { id, tag, until: now + after, cap: now + after + MAX_WAIT_MS, live });
    if ( !ticking ) { canvas.app.ticker.add(tick); ticking = true; }
  } else drop(id, tag);
}

/** Foundry has refreshed a token: a held one gets its keys back. */
export function onRefresh(token) { if ( HOLDS.size && HOLDS.has(token?.document?.id) ) enforce(token); }

/** Everything let go (the scene goes away). */
export function clear() {
  PENDING.clear(); stopTick();
  for ( const id of [...HOLDS.keys()] ) { HOLDS.get(id).clear(); drop(id, null); }
  setUnder(false);
}

export const _frontState = () => ({ holds: [...HOLDS].map(([id, s]) => [id, [...s]]), under: isUnder, pending: PENDING.size, ticking });
