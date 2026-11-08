/**
 * What the GM marks on the zones (Invincible core book, "Maps & Zones", "Movement", "Slugfest", "Other Hazards"):
 *  - BORDERS between two zones: open (default), a door, a locked door, an interior wall, an exterior (building) wall, a reinforced
 *    wall - with the Armor the book gives a breach (door 1, locked door 2, wall 2, exterior wall 3, reinforced 4+);
 *  - zone FEATURES (stay): a building (its rooftop is an elevated position), tall features (trees, cranes, power lines: SWINGING can
 *    end there), water (SWIMMING), and the terrain that sets what wrecking it takes (office 4/+1 ... cliffs 9/+6, or "cannot be
 *    wrecked": a flat field, open air);
 *  - zone STATES (during a scene): wrecked, burning (Intensity), darkness, ice, flooded, low gravity.
 * Marks are stored as points (a border mark: a point on the border; a zone mark: a point inside the zone), so they keep to their
 * border or zone while the pencil lines change and the zones are numbered anew. Pure functions: no Foundry here.
 */

export const BORDER_KINDS = ["open", "door", "locked", "wall", "outer", "reinforced"];
export const ARMOR = { door: 1, locked: 2, wall: 2, outer: 3, reinforced: 4 };
export const FEATURES = ["building", "tall", "water"];
export const TERRAINS = ["", "office", "warehouse", "street", "woods", "building", "cliffs", "none"];
/** Wrecking a zone: minimum STRENGTH and attack bonus by terrain ("none": cannot be wrecked). */
export const WRECK = { office: [4, 1], warehouse: [5, 2], street: [6, 3], woods: [7, 4], building: [8, 5], cliffs: [9, 6] };
export const STATES = ["wrecked", "fire", "dark", "ice", "flooded", "lowgrav"];
export const FIRE_MAX = 12;

/** Who a border stops. Walking: every wall and a locked door. Over the top (flight, leaping, super-speed, swinging): an exterior
 *  wall is a building's wall, so they pass over it; inner walls and locked doors still stop them. Burrowing and teleportation: nothing. */
const STOPS = {
  walk: new Set(["locked", "wall", "outer", "reinforced"]),
  air: new Set(["locked", "wall", "reinforced"]),
  through: new Set()
};

export const pairKey = (a, b) => (a > b ? `${a}|${b}` : `${b}|${a}`);

/** A clean zone-mark props object (only what is set). */
export function cleanProps(p = {}) {
  const o = {};
  for ( const k of ["building", "tall", "water", "wrecked", "dark", "ice", "flooded", "lowgrav"] ) if ( p[k] === true ) o[k] = true;
  if ( TERRAINS.includes(p.terrain) && p.terrain ) o.terrain = p.terrain;
  const f = Math.round(Number(p.fire) || 0);
  if ( f > 0 ) o.fire = Math.min(FIRE_MAX, f);
  return o;
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
 * The marks laid onto the zones as they are now: borders (pair -> { kind, x, y }) and zone props (id -> props).
 * `zoneAt(x, y)` finds a zone; a border mark farther than `tol` from every border is dropped (its border was erased).
 */
export function resolve(Z, walls, marks, zoneAt, tol) {
  const borders = new Map(), zones = new Map();
  if ( !Z ) return { borders, zones };
  for ( const [x, y, kind] of walls ?? [] ) {
    if ( !BORDER_KINDS.includes(kind) || kind === "open" ) continue;
    const nb = nearestBorder(Z, x, y, tol);
    if ( nb ) borders.set(pairKey(nb.a, nb.b), { kind, x: nb.x, y: nb.y, a: nb.a, b: nb.b });
  }
  for ( const [x, y, p] of marks ?? [] ) {
    const id = zoneAt(x, y);
    if ( id < 0 ) continue;
    zones.set(id, { ...(zones.get(id) ?? {}), ...cleanProps(p) });
  }
  return { borders, zones };
}

/** Zones reachable from `from` with the borders that stop this way of moving; `onlyThrough(id)` limits the zones passed (water). */
function bfs(Z, from, M, way, onlyThrough = null) {
  const stops = STOPS[way], d = new Map();
  if ( !Z || from < 0 || !Z.adj.has(from) ) return d;
  d.set(from, 0);
  const q = [from];
  for ( let k = 0; k < q.length; k++ ) {
    const a = q[k];
    for ( const b of Z.adj.get(a).keys() ) {
      if ( d.has(b) ) continue;
      const kind = M?.borders.get(pairKey(a, b))?.kind;
      if ( kind && stops.has(kind) ) continue;
      if ( onlyThrough && !onlyThrough(b) ) continue;
      d.set(b, d.get(a) + 1); q.push(b);
    }
  }
  return d;
}

/**
 * Distances from a zone for each way of moving: walk (walls and locked doors stop it), air (over buildings: only inner walls and
 * locked doors stop it), through (burrowing, teleportation: nothing stops it), swim (only through water: water zones or flooded
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
        if ( M.borders.get(pairKey(id, b)) ) return false;          // any wall or door blocks the border
        const q = next.get(b) ?? {};
        return !q.fire && !q.water && !q.flooded && !(M.zones.get(b)?.fire);
      });
      if ( can.length ) { const to = can[Math.floor(rnd() * can.length)]; next.set(to, { ...(next.get(to) ?? {}), fire: p.fire }); row.to = to; }
    }
    log.push(row);
  }
  return { next, log };
}
