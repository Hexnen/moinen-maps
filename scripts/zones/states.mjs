import { FIRE_MAX } from "./marks.mjs";
import { parseSpot } from "./places.mjs";

/**
 * The zone-state registry and the temporary edges (pure, no Foundry) - combat-plan 5.7 items 3 and 9.
 *
 * A ZONE STATE is something that holds in a zone for a while: the zone is wrecked, burns, lies in darkness or smoke, has its
 * gravity changed, a storm in it, is flooded, toxic, iced over - or anything else a rule names. The map STORES and REPORTS a state
 * with who made it, how strong it is, when it ends and whom it spares, and draws the ones it already drew (below). What a state
 * DOES is the combat module's: nothing here rolls, hurts, slows or ends anything. Nothing here ends a state on its own either:
 * `ends` is a note for the one who made it, and clearing is a call (a GM action or the owner's).
 *
 *   state = { id, kind, at?, level?, owner?, ends?, except?, data? }
 *   id      unique in the scene, never reused ("s7"); given by the registry
 *   kind    "wrecked" | "fire" | "dark" | "smoke" | "gravity" | "weather" | "flooded" | "toxic" | "ice", or any other name the rules
 *           need (letters, digits, "_", "-")
 *   at      the level of the zone it holds on: "ground" | "elevated" | "underground" | "f<n>"; absent: the zone, no level named
 *           (by the book an elevated position is a zone of its own above the ground: book-dump 2258 - which levels a state reaches
 *           is its maker's to say; 1702: changed gravity takes the ground zone and the elevated zone above it)
 *   level   how strong: a number (a fire's Intensity: 2925; a power's level value), meaning by kind
 *   owner   who or what made it (opaque: a combatant id, an effect source object)
 *   ends    when it ends (opaque: the combat module's end condition - "a few minutes", until the owner is broken: 1654, 1841)
 *   except  ids of those it does not touch (1654: one is never affected by one's own darkness; 1841: nor by one's own storm)
 *   data    anything else the rules need to keep with it (gravity: { mode: "low" | "high" } 1703-1704; weather: { type: "storm" } 1841)
 *
 * Where the book gives these states their content (for whoever reads them, not computed here): fire 2925-2927, darkness 1654,
 * gravity 1702-1704, storm 1841, toxic area 2889, smoke 2646, flooding 1832, wrecking 2454-2457. Ice has none.
 *
 * Stored like the zone marks, as a point inside the zone (`q: [[x, y, state], ...]`), so a state keeps to its zone while the
 * pencil lines change. A state the map already knows how to show reads as the zone property the icons, the routes and the older
 * API use (`propsOf`): wrecked, fire (its level as the Intensity), dark, ice, flooded, gravity with data.mode "low". The others
 * are stored and reported only.
 *
 * A TEMPORARY EDGE joins two places that are not neighbours, or passes under a wall, for as long as it lasts:
 *   edge = { id, kind, a, b, owner?, ends?, ways?, data? }
 *   kind    "portal" (two-way, between any two places: book-dump 1666, 2040) | "tunnel" (a passage others can follow: 1996), or
 *           another name
 *   a, b    spot strings (places.mjs): "z3", "z3:f2", "z7:underground", or an off-map area ("@dimension"); two-way
 *   ways    the ways of moving that may use it (absent: every way)
 * Stored by zone key (`e: [edge, ...]`); an edge whose zone is gone sleeps and wakes with the zone (an undo, the line redrawn).
 * How far an edge counts and who fits through it is not in the book: the movement planner counts one step (moves.mjs, our reading,
 * switchable per mover), range never uses edges.
 */

export const STATE_KINDS = ["wrecked", "fire", "dark", "smoke", "gravity", "weather", "flooded", "toxic", "ice"];
export const EDGE_KINDS = ["portal", "tunnel"];
export const NAME_RE = /^[a-z][A-Za-z0-9_-]{0,31}$/;
export const ID_RE = /^[A-Za-z0-9_.:-]{1,48}$/;
export const AT_RE = /^(ground|elevated|underground|f[1-9]\d?)$/;
/** The most characters an owner / ends / data value may take as JSON (the scene flag is sent to every client). */
export const OPAQUE_MAX = 2000;
export const EXCEPT_MAX = 64;

/** A value kept as it is given, if it survives JSON and is not too big: [ok, value]. */
function opaque(v) {
  if ( v == null ) return [true, undefined];
  let text;
  try { text = JSON.stringify(v); } catch { return [false]; }
  if ( text == null || text.length > OPAQUE_MAX ) return [false];
  return [true, JSON.parse(text)];
}

/** The level a spot string names, as a state's `at` ("z3:f2" -> "f2", "z3" -> "ground"); null: none. */
export function atOfSpot(spot) {
  const s = parseSpot(spot);
  if ( !s || s.key[0] === "@" ) return null;
  return s.floor ? `f${s.floor}` : s.alt;
}

/**
 * A state record, cleaned (unknown fields dropped). null: not a state (no kind, a bad id, a value that cannot be stored).
 * `id` is kept when given and well-formed; the registry gives one otherwise.
 */
export function cleanState(r) {
  if ( !r || typeof r !== "object" || typeof r.kind !== "string" || !NAME_RE.test(r.kind) ) return null;
  const out = {};
  if ( r.id != null ) { if ( typeof r.id !== "string" || !ID_RE.test(r.id) ) return null; out.id = r.id; }
  out.kind = r.kind;
  if ( r.at != null ) { if ( typeof r.at !== "string" || !AT_RE.test(r.at) ) return null; out.at = r.at; }
  if ( r.level != null ) { const n = Number(r.level); if ( !Number.isFinite(n) ) return null; out.level = n; }
  for ( const k of ["owner", "ends", "data"] ) { const [ok, v] = opaque(r[k]); if ( !ok ) return null; if ( v !== undefined ) out[k] = v; }
  if ( r.except != null ) {
    if ( !Array.isArray(r.except) ) return null;
    const ex = [...new Set(r.except.filter((s) => typeof s === "string" && s.length > 0 && s.length <= 64))].slice(0, EXCEPT_MAX);
    if ( ex.length ) out.except = ex;
  }
  return out;
}

/** The stored states, cleaned: [[x, y, state], ...], one per id (the first wins). */
export function cleanStates(list) {
  const out = [], seen = new Set();
  for ( const row of Array.isArray(list) ? list : [] ) {
    if ( !Array.isArray(row) ) continue;
    const [x, y, r] = row, c = cleanState(r);
    if ( !Number.isFinite(x) || !Number.isFinite(y) || !c?.id || seen.has(c.id) ) continue;
    seen.add(c.id); out.push([x, y, c]);
  }
  return out;
}

/** The states laid onto the zones as they are now: zone id -> [state, ...] (stored order). */
export function resolveStates(list, zoneAt) {
  const by = new Map();
  for ( const [x, y, r] of list ?? [] ) {
    const id = zoneAt(x, y);
    if ( id < 0 ) continue;
    (by.get(id) ?? by.set(id, []).get(id)).push(r);
  }
  return by;
}

/**
 * What a zone's states read as in the zone properties the map draws and the routes use (see the top): { wrecked, fire, dark, ice,
 * flooded, lowgrav } - only what is set. A fire needs its Intensity (level >= 1) to read as one; of several the highest counts.
 */
export function propsOf(states) {
  const p = {};
  for ( const r of states ?? [] ) {
    if ( r.kind === "wrecked" || r.kind === "dark" || r.kind === "ice" || r.kind === "flooded" ) p[r.kind] = true;
    else if ( r.kind === "fire" ) { const n = Math.min(FIRE_MAX, Math.round(Number(r.level) || 0)); if ( n >= 1 ) p.fire = Math.max(p.fire ?? 0, n); }
    else if ( r.kind === "gravity" && r.data?.mode === "low" ) p.lowgrav = true;
  }
  return p;
}
/** Zone properties with the states' on top (a fire: the higher Intensity). */
export function mergeProps(base, add) {
  const out = { ...(base ?? {}), ...add };
  if ( base?.fire && add.fire ) out.fire = Math.max(base.fire, add.fire);
  return out;
}

const PROP_KIND = { wrecked: ["wrecked"], fire: ["fire"], dark: ["dark"], ice: ["ice"], flooded: ["flooded"], lowgrav: ["gravity", { mode: "low" }] };
/** The states a set of zone properties stands for, as records (`source`: "mark" the GM's own mark, "map" read from the map's layers). */
function fromProps(p, source) {
  const out = [];
  for ( const [k, [kind, data]] of Object.entries(PROP_KIND) ) {
    if ( !p?.[k] ) continue;
    out.push({ id: `${source}:${k}`, kind, ...(k === "fire" ? { level: p.fire } : {}), ...(data ? { data: { ...data } } : {}), source });
  }
  return out;
}

/**
 * Every state of a zone as records: the registry's (source "registry"), the GM's own marks (source "mark", id "mark:<prop>") and
 * what the map's layers show (source "map", id "map:<prop>": painted fire, wreckage, water). `at`: a level ("ground", "f2", ...)
 * keeps the registry states of that level and those with no level named; marks and layers name no level.
 */
export function listStates(states, ownProps, mapProps, at = null) {
  const out = [];
  for ( const r of states ?? [] ) if ( at == null || r.at == null || r.at === at ) out.push({ ...r, source: "registry" });
  return [...out, ...fromProps(ownProps, "mark"), ...fromProps(mapProps, "map")];
}

/** One string that changes whenever a zone's registry states do. */
export const statesSig = (states) => (states?.length ? JSON.stringify(states) : "");

/* ---------------------------------------------------------------- temporary edges */

/** An edge record, cleaned. null: not an edge. `a` and `b` are spot strings (a zone key with an optional level, or an off-map area). */
export function cleanEdge(e) {
  if ( !e || typeof e !== "object" || typeof e.kind !== "string" || !NAME_RE.test(e.kind) ) return null;
  const out = {};
  if ( e.id != null ) { if ( typeof e.id !== "string" || !ID_RE.test(e.id) ) return null; out.id = e.id; }
  out.kind = e.kind;
  for ( const k of ["a", "b"] ) { if ( typeof e[k] !== "string" || !parseSpot(e[k]) ) return null; out[k] = e[k]; }
  if ( out.a === out.b ) return null;
  for ( const k of ["owner", "ends", "data"] ) { const [ok, v] = opaque(e[k]); if ( !ok ) return null; if ( v !== undefined ) out[k] = v; }
  if ( e.ways != null ) {
    if ( !Array.isArray(e.ways) ) return null;
    const w = [...new Set(e.ways.filter((s) => typeof s === "string" && NAME_RE.test(s)))];
    if ( w.length ) out.ways = w;
  }
  return out;
}
export function cleanEdges(list) {
  const out = [], seen = new Set();
  for ( const e of Array.isArray(list) ? list : [] ) {
    const c = cleanEdge(e);
    if ( !c?.id || seen.has(c.id) ) continue;
    seen.add(c.id); out.push(c);
  }
  return out;
}

/**
 * The edges that join two zones of the map as it is now: [{ ...edge, ids: [a, b] }] (an edge to an off-map area or to a zone that
 * is gone is stored and listed by the registry, but joins nothing here), and `links`: zone id -> [{ to, edge }] both ways.
 */
export function resolveEdges(list, idOf) {
  const live = [], links = new Map();
  for ( const e of list ?? [] ) {
    const a = parseSpot(e.a), b = parseSpot(e.b);
    if ( !a || !b || a.key[0] === "@" || b.key[0] === "@" ) continue;
    const ia = idOf(a.key), ib = idOf(b.key);
    if ( !(ia >= 0) || !(ib >= 0) ) continue;
    const row = { ...e, ids: [ia, ib] };
    live.push(row);
    if ( ia === ib ) continue;                    // between two levels of one zone: nothing to join on the map
    (links.get(ia) ?? links.set(ia, []).get(ia)).push({ to: ib, edge: row });
    (links.get(ib) ?? links.set(ib, []).get(ib)).push({ to: ia, edge: row });
  }
  return { live, links };
}
