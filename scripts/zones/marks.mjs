/**
 * What the GM marks on the zones (Invincible core book, "Maps & Zones", "Movement", "Slugfest", "Other Hazards"):
 *  - BORDERS between two zones: open (default), a door, a locked door, an interior wall, an exterior (building) wall, a reinforced
 *    wall - with the Armor the book gives a breach (door 1, locked door 2, wall 2, exterior wall 3, reinforced 4+);
 *  - zone FEATURES (stay): a building (its rooftop is an elevated position), tall features (trees, cranes, power lines: SWINGING can
 *    end there), water (SWIMMING), and the terrain that sets what wrecking it takes (office 4/+1 ... cliffs 9/+6, or "cannot be
 *    wrecked": a flat field, open air);
 *  - zone STATES (during a scene): wrecked, burning (Intensity), darkness, ice, flooded, low gravity.
 *  - zone ATTRIBUTES the rules read (stored only; a combat module works out what they do): an EMPTY zone (nothing in it to trap
 *    someone under: book-dump 2438) and RESOURCE TAGS - what a power or a stunt may need to find in the zone (plan 5.7 item 8).
 * Marks are stored as points (a border mark: a point on the border; a zone mark: a point inside the zone), so they keep to their
 * border or zone while the pencil lines change and the zones are numbered anew. Pure functions: no Foundry here.
 *
 * A border mark's kind is the short form of the wall-plus-door model (borders.mjs): every resolved border carries its wall, its
 * door, their Armor and states, and `kind` / `stops` say what it amounts to now (a breached wall reads as "open").
 */
import * as Borders from "./borders.mjs";

export const BORDER_KINDS = ["open", "door", "locked", "wall", "outer", "reinforced"];
export const ARMOR = { door: 1, locked: 2, wall: 2, outer: 3, reinforced: 4 };
export const FEATURES = ["building", "tall", "water"];
export const TERRAINS = ["", "office", "warehouse", "street", "woods", "building", "cliffs", "none"];
/** Wrecking a zone: minimum STRENGTH and attack bonus by terrain ("none": cannot be wrecked). */
export const WRECK = { office: [4, 1], warehouse: [5, 2], street: [6, 3], woods: [7, 4], building: [8, 5], cliffs: [9, 6] };
/** What a zone may hold that powers and stunts ask for (stored as `tags`; "water" and "tall" are the features above, see tagsOf). */
export const TAGS = ["power", "metal", "plants", "throwables", "flammable", "vacuum", "bystanders"];
export const STATES = ["wrecked", "fire", "dark", "ice", "flooded", "lowgrav"];
export const FIRE_MAX = 12;
/** Floors above the ground floor a building may have (book: each floor of a large building is a vertical zone of its own). */
export const FLOORS_MAX = 40;

/** Who a border stops by itself. Walking: every wall and a locked door. Over the top (flight, leaping, super-speed, swinging): an
 *  exterior wall is a building's wall, so they pass over it; inner walls and locked doors still stop them - unless the zones on
 *  its two sides say it is a building's edge (stopped(): A14). Burrowing and teleportation: nothing. */
const STOPS = {
  walk: new Set(["locked", "wall", "outer", "reinforced"]),
  air: new Set(["locked", "wall", "reinforced"]),
  through: new Set()
};

export const pairKey = (a, b) => (a > b ? `${a}|${b}` : `${b}|${a}`);
/** Whether a resolved border stops a way of moving (walk, air, through): by its wall and door now (borders.mjs), else by its kind. */
const stopsWay = (m, way) => !!m && (m.stops ? !!m.stops[way] : STOPS[way].has(m.kind));

/** A clean zone-mark props object (only what is set). */
export function cleanProps(p = {}) {
  const o = {};
  for ( const k of ["building", "tall", "water", "empty", "wrecked", "dark", "ice", "flooded", "lowgrav"] ) if ( p[k] === true ) o[k] = true;
  if ( Array.isArray(p.tags) ) { const t = TAGS.filter((k) => p.tags.includes(k)); if ( t.length ) o.tags = t; }
  if ( TERRAINS.includes(p.terrain) && p.terrain ) o.terrain = p.terrain;
  const f = Math.round(Number(p.fire) || 0);
  if ( f > 0 ) o.fire = Math.min(FIRE_MAX, f);
  const fl = Math.round(Number(p.floors) || 0);
  if ( fl > 0 ) o.floors = Math.min(FLOORS_MAX, fl);
  return o;
}
/** Every resource tag of a zone: the stored ones with the features that are resources too (water, tall features). */
export const tagsOf = (p) => [...(p?.water || p?.flooded ? ["water"] : []), ...(p?.tall ? ["tall"] : []), ...(p?.tags ?? [])];
/**
 * What wrecking a zone takes (book-dump 2454-2457 and the table after 2458): { can, strength, bonus, why }. `can` false: already
 * wrecked ("wrecked") or terrain that cannot be wrecked ("terrain"); null: no terrain set, the GM decides ("unset").
 */
export function wreckOf(p) {
  if ( p?.wrecked ) return { can: false, strength: null, bonus: null, why: "wrecked" };
  if ( p?.terrain === "none" ) return { can: false, strength: null, bonus: null, why: "terrain" };
  const w = WRECK[p?.terrain];
  return w ? { can: true, strength: w[0], bonus: w[1], why: null } : { can: null, strength: null, bonus: null, why: "unset" };
}
export const hasStates = (p) => !!(p.wrecked || p.fire || p.dark || p.ice || p.flooded || p.lowgrav);
export const withoutStates = (p) => { const o = { ...p }; for ( const k of STATES ) delete o[k]; return o; };

function segDist(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
  const px = ax + dx * t, py = ay + dy * t;
  return { d: Math.hypot(x - px, y - py), x: px, y: py };
}

/** The border between two zones nearest to a point, within `tol`: { a, b, x, y, d } (the point on it), or null. */
export function nearestBorder(Z, x, y, tol) {
  let best = null;
  for ( const br of Z?.borders ?? [] ) {
    if ( br.b < 0 || br.a < 0 || br.edge ) continue;
    const s = segDist(x, y, br.pts[0], br.pts[1], br.pts[2], br.pts[3]);
    if ( s.d <= tol && (!best || s.d < best.d) ) best = { a: br.a, b: br.b, x: s.x, y: s.y, d: s.d };
  }
  return best;
}

/**
 * The marks laid onto the zones as they are now: borders (pair -> { kind, base, wall, door, armor, look, stops, x, y, a, b }:
 * borders.mjs model()) and zone props (id -> props).
 * `zoneAt(x, y)` finds a zone; a border mark farther than `tol` from every border is dropped (its border was erased).
 * `walls`: [x, y, kind, ext?] as built; `plays`: [x, y, play] what happened to a border in play (a point on it, like a mark).
 */
export function resolve(Z, walls, marks, zoneAt, tol, plays = null) {
  const borders = new Map(), zones = new Map();
  if ( !Z ) return { borders, zones };
  const play = new Map();
  for ( const [x, y, p] of plays ?? [] ) { const nb = nearestBorder(Z, x, y, tol); if ( nb ) play.set(pairKey(nb.a, nb.b), p); }
  for ( const [x, y, kind, ext] of walls ?? [] ) {
    if ( !BORDER_KINDS.includes(kind) || kind === "open" ) continue;
    const nb = nearestBorder(Z, x, y, tol);
    if ( !nb ) continue;
    const pk = pairKey(nb.a, nb.b);
    borders.set(pk, { ...Borders.model(kind, ext, play.get(pk)), x: nb.x, y: nb.y, a: nb.a, b: nb.b });
  }
  for ( const [x, y, p] of marks ?? [] ) {
    const id = zoneAt(x, y);
    if ( id < 0 ) continue;
    zones.set(id, { ...(zones.get(id) ?? {}), ...cleanProps(p) });
  }
  return { borders, zones };
}

/** A standing building: a zone with a roof to pass over (a wrecked one has none left, book-dump 2457). */
const roofed = (M, id) => { const p = M?.zones.get(id); return !!(p?.building && !p.wrecked); };
/**
 * Whether the border between two adjacent zones stops this way of moving (walk, air, through).
 * Over the top (A14, the user's answer of 2026-11-12, book-dump 2385 "flyers pass over buildings"): from outside a flyer passes
 * over every building, by its roof, whatever the wall between is marked as - a blocked border between a standing building and a
 * zone that is not one does not stop it. A wall between two standing buildings is a wall inside a building and stops it, unless
 * it is marked a building's exterior wall (two buildings side by side). A freestanding wall (neither zone a building) stops it
 * unless it is marked exterior, as before.
 */
export function stopped(M, a, b, way) {
  const m = M?.borders.get(pairKey(a, b));
  if ( !stopsWay(m, way) ) return false;
  return !(way === "air" && roofed(M, a) !== roofed(M, b));
}
/** A zone one can swim through: water or flooded. */
export const isWater = (M, id) => { const p = M?.zones.get(id); return !!(p?.water || p?.flooded); };

/** Zones reachable from `from` with the borders that stop this way of moving; `onlyThrough(id)` limits the zones passed (water). */
function bfs(Z, from, M, way, onlyThrough = null) {
  const d = new Map();
  if ( !Z || from < 0 || !Z.adj.has(from) ) return d;
  d.set(from, 0);
  const q = [from];
  for ( let k = 0; k < q.length; k++ ) {
    const a = q[k];
    for ( const b of Z.adj.get(a).keys() ) {
      if ( d.has(b) ) continue;
      if ( stopped(M, a, b, way) ) continue;
      if ( onlyThrough && !onlyThrough(b) ) continue;
      d.set(b, d.get(a) + 1); q.push(b);
    }
  }
  return d;
}

/**
 * Distances from a zone for each way of moving: walk (walls and locked doors stop it), air (over buildings: only walls and locked
 * doors inside a building or between two open zones stop it, see stopped()), through (burrowing, teleportation: nothing stops it), swim (only through water: water zones or flooded
 * ones), and swing (as air, but it can only END in a building or a zone with tall features).
 */
export function moveDistances(Z, from, M) {
  const water = (id) => { const p = M?.zones.get(id); return !!(p?.water || p?.flooded); };
  const air = bfs(Z, from, M, "air");
  const swing = new Map();
  // a wrecked building has no rooftop left to swing onto; tall features (trees, cranes) still work
  for ( const [id, d] of air ) { const p = M?.zones.get(id); if ( id === from || p?.tall || (p?.building && !p.wrecked) ) swing.set(id, d); }
  return { walk: bfs(Z, from, M, "walk"), air, through: bfs(Z, from, M, "through"), swim: bfs(Z, from, M, "walk", water), swing };
}

/** Floors above the ground floor of a zone: a standing building's (a wrecked one has none left). */
export const floorsOf = (M, id) => { const p = M?.zones.get(id); return p?.building && !p.wrecked ? (p.floors ?? 0) : 0; };

/**
 * How high a token stands inside its zone, in vertical zones: its floor (1..floors), the rooftop of a building with floors one above
 * the top floor, else 0. Walking and swimming have to come down to the ground first; flight and swinging leave by a window or the
 * roof, burrowing and teleportation do not count it (our reading: the book only says each floor is a vertical zone).
 */
export function vertical(M, id, floor, alt) {
  const n = floorsOf(M, id);
  if ( !n ) return 0;
  if ( alt === "elevated" ) return n + 1;
  return Math.max(0, Math.min(n, Math.round(Number(floor) || 0)));
}
/** Distances with the way down added for those who need it (every zone but the token's own). */
export function addVertical(dd, v) {
  if ( !v ) return dd;
  return { ...dd, walk: dd.walk == null ? undefined : dd.walk + v, swim: dd.swim == null ? undefined : dd.swim + v };
}

/** The distances one zone gets, as the presets take them: { walk, air, through, swim, swing } (undefined = no way). */
export const distancesTo = (D, id) => ({ walk: D.walk.get(id), air: D.air.get(id), through: D.through.get(id), swim: D.swim.get(id), swing: D.swing.get(id) });

/**
 * One round of fire (book: "Fire Spreading"): every burning zone rolls a D6 - 1-2 the fire goes out, 5-6 it spreads to a random
 * adjacent zone (same Intensity) whose border is open and that can burn (not water, not flooded, not burning already).
 * `rnd()` -> [0, 1). Returns { next: Map id -> props, log: [{ id, roll, out?, to? }] }.
 */
export function fireRound(Z, M, rnd = Math.random) {
  const next = new Map([...M.zones].map(([id, p]) => [id, { ...p }]));
  const log = [];
  for ( const [id, p] of M.zones ) {
    if ( !p.fire ) continue;
    const roll = 1 + Math.floor(rnd() * 6);
    const row = { id, roll };
    if ( roll <= 2 ) { delete next.get(id).fire; row.out = true; }
    else if ( roll >= 5 ) {
      const can = [...(Z.adj.get(id)?.keys() ?? [])].filter((b) => {
        // any standing wall or door blocks the border (a wall that was breached or removed no longer does)
        const m = M.borders.get(pairKey(id, b));
        if ( m && m.kind !== "open" ) return false;
        const q = next.get(b) ?? {};
        return !q.fire && !q.water && !q.flooded && !(M.zones.get(b)?.fire);
      });
      if ( can.length ) { const to = can[Math.floor(rnd() * can.length)]; next.set(to, { ...(next.get(to) ?? {}), fire: p.fire }); row.to = to; }
    }
    log.push(row);
  }
  return { next, log };
}
