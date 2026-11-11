import { pairKey, floorsOf, stopped, isWater, moveDistances, tagsOf, wreckOf } from "./marks.mjs";
import { distances } from "./geometry.mjs";
import { OPEN, partsOf } from "./borders.mjs";
import { listStates } from "./states.mjs";

/**
 * Where something is, in three dimensions, and how far apart two such places are (pure, no Foundry). The zones on the map are flat;
 * the Invincible core book stacks levels on them and takes some characters off the map altogether:
 *  - a zone is a room, a rooftop or a stretch of ground (book-dump 2253); on a city map a building's rooftop is a zone of its own
 *    above the building (2254), and a typical building is ONE zone for horizontal and vertical movement (2404);
 *  - elevated: on a rooftop or airborne at that height, one zone above the ground, and everyone elevated in the same horizontal
 *    zone is in the same zone (2258);
 *  - a large building's floors are vertical zones of their own (2262, 2419);
 *  - sky high and in orbit are OFF the map: everyone there is in one zone, nobody attacks into or out of it (2259, 2260);
 *  - burrowing moves underground (1995).
 * "Another dimension" and "a chase" as off-map areas, and "underground" as a level one can stay on, are not in the book: they are
 * the plan's (combat-plan 5.7 items 5 and 6) and are only stored and reported here.
 *
 * A PLACE:
 *   { zone, id, spot, area, level, floor, airborne, roof, below }
 *   zone      the stable key of the zone (keys.mjs), "@sky" / "@orbit" / "@dimension" / "@chase" off the map, null outside every zone
 *   id        the zone's id now (-1 off the map or outside every zone)
 *   spot      the 3-D zone as one string: "z3" (ground), "z3:underground", "z3:elevated", "z3:f2" (floor 2), "@sky"; two
 *             characters are "in the same zone" by the book exactly when their spots are equal
 *   area      null on the map, else "sky" | "orbit" | "dimension" | "chase"
 *   level     "underground" | "ground" | "elevated" | "floor" (null off the map)
 *   floor     1..n on level "floor", else 0
 *   airborne  elevated and not standing on a rooftop;   roof: elevated and standing on the rooftop of a standing building
 *   below     off the map: the key of the zone under the token's spot on the map (where it left from), else null
 *
 * Two distances (book-dump 2254-2255; combat-plan rule 23):
 *   range  = the zone borders on the shortest route, a blocked border still being a border (attacks, powers, areas);
 *   route  = the borders on the shortest route this way of moving can take (walk, air, through, swim, swing: marks.mjs).
 */

export const LEVELS = ["underground", "ground", "elevated", "floor"];
export const AREAS = ["sky", "orbit", "dimension", "chase"];
/** The ways of moving a route can be asked for (marks.mjs), and "range" for the plain count of borders. */
export const WAYS = ["walk", "air", "through", "swim", "swing"];
export const areaKey = (area) => `@${area}`;
export const areaOfKey = (key) => (typeof key === "string" && key[0] === "@" && AREAS.includes(key.slice(1)) ? key.slice(1) : null);
/** The token flag `alt` holds one of these (the first four are the book's altitudes; zones.mjs ALTS). */
export const ALT_VALUES = ["ground", "elevated", "underground", ...AREAS];

const spotOf = (zone, level, floor) => (level === "ground" ? zone : level === "floor" ? `${zone}:f${floor}` : `${zone}:${level}`);

/**
 * A place from what a token's flags say (or what a caller asks about).
 * @param {object|null} M                      the marks ({ zones: Map id -> props })
 * @param {(id: number) => string|null} keyOf
 * @param {{ id: number, alt?: string, floor?: number, air?: boolean }} at    id: the zone under the point (-1: none)
 */
export function makePlace(M, keyOf, { id = -1, alt = "ground", floor = 0, air = false } = {}) {
  const zone = id >= 0 ? (keyOf(id) ?? null) : null;
  if ( AREAS.includes(alt) ) return { zone: areaKey(alt), id: -1, spot: areaKey(alt), area: alt, level: null, floor: 0, airborne: false, roof: false, below: zone };
  const base = { zone, id: zone == null ? -1 : id, area: null, floor: 0, airborne: false, roof: false, below: null };
  if ( zone == null ) return { ...base, spot: null, level: LEVELS.includes(alt) && alt !== "floor" ? alt : "ground", airborne: alt === "elevated" };
  if ( alt === "underground" ) return { ...base, level: "underground", spot: spotOf(zone, "underground") };
  if ( alt === "elevated" ) {
    // a wrecked building has no rooftop left (book-dump 2457): up there one is in the air
    const p = M?.zones.get(id), roof = !air && !!p?.building && !p.wrecked;
    return { ...base, level: "elevated", roof, airborne: !roof, spot: spotOf(zone, "elevated") };
  }
  const n = floorsOf(M, id), f = Math.round(Number(floor) || 0);
  if ( f > 0 && f <= n ) return { ...base, level: "floor", floor: f, spot: spotOf(zone, "floor", f) };
  return { ...base, level: "ground", spot: zone };
}

/** A place written as a spot string ("z3", "z3:elevated", "z3:f2", "z3:underground", "@sky"): { key, alt, floor } or null. */
export function parseSpot(s) {
  if ( typeof s !== "string" || !s ) return null;
  if ( s[0] === "@" ) { const a = areaOfKey(s); return a ? { key: s, alt: a, floor: 0 } : null; }
  const i = s.indexOf(":");
  if ( i < 0 ) return { key: s, alt: "ground", floor: 0 };
  const key = s.slice(0, i), t = s.slice(i + 1), m = /^f(\d+)$/.exec(t);
  if ( m ) return { key, alt: "ground", floor: Number(m[1]) };
  return t === "elevated" || t === "underground" || t === "ground" ? { key, alt: t, floor: 0 } : null;
}

export const sameSpot = (a, b) => !!a && !!b && a.spot != null && a.spot === b.spot;
/** A place as one string, for telling a change (the spot, and whether one stands or flies up there). */
export const placeSig = (p) => (p ? `${p.spot ?? "-"}${p.airborne ? "~" : ""}` : "");

/**
 * How many vertical zones above the ground a place is: a floor its number, the rooftop of a building with floors one above the top
 * floor, any other elevated position 1 (book-dump 2258), underground -1 (our reading: the book gives underground no height).
 */
export function heightOf(M, p) {
  if ( !p || p.area ) return null;
  if ( p.level === "underground" ) return -1;
  if ( p.level === "floor" ) return p.floor;
  if ( p.level === "elevated" ) return p.roof ? floorsOf(M, p.id) + 1 : 1;
  return 0;
}

/* ---------------------------------------------------------------- the cache of one state of the zones */

/**
 * The lookups of one state of the zones and marks, worked out as they are asked for. Make a new one whenever Z or M changes
 * (zones.mjs keeps one per zones version); everything in it is read-only.
 * `X` (optional) is what the registry adds to this state (states.mjs): { states: Map id -> [state], own: Map id -> the GM's own
 * props, map: Map id -> what the layers show, links: Map id -> [{ to, edge }] the temporary edges }.
 */
export function makeCache(Z, M, X = null) {
  return { Z, M, X, range: new Map(), moves: new Map(), pairs: null, steps: new Map() };
}
/** Borders from a zone to every zone, blocked borders counted like any other (the "range" distance). */
export function rangeFrom(C, from) {
  let d = C.range.get(from);
  if ( !d ) C.range.set(from, d = distances(C.Z, from));
  return d;
}
/** Distances from a zone by each way of moving (marks.mjs moveDistances). */
export function movesFrom(C, from) {
  let d = C.moves.get(from);
  if ( !d ) C.moves.set(from, d = moveDistances(C.Z, from, C.M));
  return d;
}
/** Every pair of neighbouring zones: pairKey -> { a, b, len, x, y } (x, y: the middle of the longest stretch of their border). */
export function pairsOf(C) {
  if ( C.pairs ) return C.pairs;
  const pairs = C.pairs = new Map();
  for ( const br of C.Z?.borders ?? [] ) {
    if ( br.a < 0 || br.b < 0 ) continue;
    const k = pairKey(br.a, br.b);
    let p = pairs.get(k);
    if ( !p ) pairs.set(k, p = { a: br.a, b: br.b, len: 0, best: 0, x: 0, y: 0 });
    p.len += br.len;
    if ( br.len > p.best ) { p.best = br.len; p.x = (br.pts[0] + br.pts[2]) / 2; p.y = (br.pts[1] + br.pts[3]) / 2; }
  }
  return pairs;
}

/* ---------------------------------------------------------------- borders and zones as data */

/** The stable key of a border: its two zone keys, sorted, joined by "|". */
export const borderKey = (ka, kb) => (ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`);

/**
 * The border between two zones (ids), or null when they are not neighbours:
 *   { key, zones: [keyA, keyB], ids: [a, b], kind, armor, door, stops: { walk, air, through }, length, x, y,
 *     base, wall: { armor, state, outer, temp } | null, doorway: { armor, state, built } | null }
 * kind: what the border amounts to now - open | door | locked | wall | outer | reinforced (borders.mjs: a breached wall is "open");
 * armor: what a breach has to beat now (0: nothing to breach); door: whether there is a door in a standing wall;
 * stops: whom it stops now; x, y: the GM's mark on it, else the middle of its longest stretch;
 * base: the kind as built; wall / doorway: the wall and the door with their own Armor and state (borders.mjs).
 */
export function borderInfo(C, keyOf, a, b) {
  const pk = pairKey(a, b), p = pairsOf(C).get(pk);
  if ( !p ) return null;
  const mark = C.M?.borders.get(pk), m = mark?.wall ? mark : null, kind = mark?.kind ?? "open", ka = keyOf(a), kb = keyOf(b);
  const parts = partsOf(m);
  return {
    key: borderKey(ka, kb), zones: [ka, kb], ids: [a, b], kind, armor: m ? m.armor : mark ? (LEGACY_ARMOR[kind] ?? 0) : 0,
    door: m ? !!m.door && m.wall.state === "intact" : kind === "door" || kind === "locked",
    stops: { walk: stopped(C.M, a, b, "walk"), air: stopped(C.M, a, b, "air"), through: false },
    length: p.len, x: mark?.x ?? p.x, y: mark?.y ?? p.y,
    base: mark?.base ?? (mark ? kind : OPEN.base), wall: parts.wall, doorway: parts.door
  };
}
// (a border resolved without the wall-and-door model: hand-made marks in tests and older callers)
const LEGACY_ARMOR = { door: 1, locked: 2, wall: 2, outer: 3, reinforced: 4 };

/**
 * A zone as data for the rules:
 *   { key, id, center: { x, y }, area (px²), neighbours: [key], building, floors, rooftop, terrain, wreck: { can, strength, bonus, why },
 *     empty, tags: [..], states: { wrecked, fire, dark, ice, flooded, lowgrav }, records: [state, ...], props }
 * rooftop: an elevated position to stand on (a standing building: book-dump 2254, 2457); props: the raw merged marks (read-only);
 * records: every state as a record with owner, level, end and exemptions (states.mjs listStates: the registry's, the GM's marks,
 * the map's layers).
 */
export function zoneInfo(C, keyOf, id) {
  const z = C.Z?.zones[id];
  if ( !z || z.id !== id ) return null;
  const p = C.M?.zones.get(id) ?? {};
  return {
    key: keyOf(id), id, center: { x: z.label.x, y: z.label.y }, area: z.area,
    neighbours: [...(C.Z.adj.get(id)?.keys() ?? [])].map(keyOf),
    building: !!p.building, floors: floorsOf(C.M, id), rooftop: !!p.building && !p.wrecked,
    terrain: p.terrain ?? "", wreck: wreckOf(p), empty: !!p.empty, tags: tagsOf(p),
    states: { wrecked: !!p.wrecked, fire: p.fire ?? 0, dark: !!p.dark, ice: !!p.ice, flooded: !!p.flooded, lowgrav: !!p.lowgrav },
    records: listStates(C.X?.states?.get(id), C.X?.own?.get(id), C.X?.map?.get(id)),
    props: p
  };
}

/* ---------------------------------------------------------------- distances */

/**
 * Range between two places: { borders, levels, total } or null (no line between them at all).
 *  - off the map: 0 inside the same area, null to or from anywhere else (book-dump 2259-2260);
 *  - borders: counted on the shortest route, blocked borders too (2254-2255);
 *  - levels: 0 between two elevated places (2258; combat-plan rule 2), else the difference in height (heightOf) - a rooftop reached
 *    from outside its building is one zone up however many floors it has (2419), so its height only counts floors from inside.
 */
export function range(C, A, B) {
  if ( !A || !B ) return null;
  if ( A.area || B.area ) return A.area && A.area === B.area ? { borders: 0, levels: 0, total: 0 } : null;
  if ( A.id < 0 || B.id < 0 ) return null;
  const borders = rangeFrom(C, A.id).get(B.id);
  if ( borders == null ) return null;
  const levels = levelGap(C.M, A, B);
  return { borders, levels, total: borders + levels };
}
function levelGap(M, A, B) {
  if ( A.level === "elevated" && B.level === "elevated" ) return 0;
  const h = (p) => (p.level === "elevated" && A.id !== B.id ? 1 : heightOf(M, p));
  return Math.abs(h(A) - h(B));
}

/**
 * The vertical zones a mover has to cross inside the building at one end of a route (0 when there is nothing to climb):
 *  - walk, swim: down (or up) the floors, a rooftop one above the top floor (2404, 2419); an airborne place cannot be walked to
 *    or from (landing or falling is a change of level the caller makes first);
 *  - air, swing, through: nothing - ground and elevated are changed as part of the move (2385), a floor is left by a window
 *    (our reading, as in marks.mjs vertical()).
 * @returns {number|null}   null: this way of moving cannot be at / get to that place
 */
export function climb(M, p, way) {
  if ( p.level === "underground" ) return way === "through" ? 0 : null;       // only burrowing goes underground (1995)
  if ( way !== "walk" && way !== "swim" ) return 0;
  if ( p.level === "elevated" ) return p.roof ? floorsOf(M, p.id) + 1 : null;
  return p.level === "floor" ? p.floor : 0;
}

/**
 * How far a route is for one way of moving: { borders, levels, total } or null (no way).
 *  - same zone, another level: walking counts the floors between; the others count 1 (a quick action: 2385) when the level differs;
 *  - to or from an area off the map: null (that is one full action whatever the distance: 2386-2387, zones.mjs altCost).
 */
export function routeLength(C, A, B, way) {
  if ( !A || !B || A.area || B.area || A.id < 0 || B.id < 0 || !WAYS.includes(way) ) return null;
  const up = climb(C.M, A, way), down = climb(C.M, B, way);
  if ( up == null || down == null ) return null;
  if ( A.id === B.id ) {
    if ( A.spot === B.spot ) return { borders: 0, levels: 0, total: 0 };
    const levels = way === "walk" || way === "swim" ? Math.abs(up - down) : 1;
    return { borders: 0, levels, total: levels };
  }
  const borders = movesFrom(C, A.id)[way].get(B.id);
  if ( borders == null ) return null;
  return { borders, levels: up + down, total: borders + up + down };
}

/** The zone ids of the shortest route (from first, to last), ties broken by the lowest id; null when there is none. */
export function chain(C, from, to, way) {
  if ( from < 0 || to < 0 ) return null;
  if ( from === to ) return [from];
  let D, pass;
  if ( way === "range" ) { D = rangeFrom(C, from); pass = () => true; }
  else {
    const all = movesFrom(C, from);
    if ( !all[way]?.has(to) ) return null;
    // swinging travels like flight and only its end is special; swimming walks through water only
    D = way === "swing" ? all.air : all[way];
    const stop = way === "swim" ? "walk" : way === "swing" ? "air" : way;
    pass = (a, b) => !stopped(C.M, a, b, stop) && (way !== "swim" || isWater(C.M, b));
  }
  if ( !D.has(to) ) return null;
  const out = [to];
  for ( let cur = to; cur !== from; ) {
    const d = D.get(cur);
    let prev = -1;
    for ( const n of C.Z.adj.get(cur).keys() ) if ( D.get(n) === d - 1 && pass(n, cur) && (prev < 0 || n < prev) ) prev = n;
    if ( prev < 0 ) return null;
    out.push(prev); cur = prev;
  }
  return out.reverse();
}

/** The level a way of moving travels at between its ends (null: wherever the mover says). */
const TRAVEL = { range: null, walk: "ground", swim: "ground", air: "elevated", swing: "elevated", through: "underground" };

/**
 * The route between two places, step by step:
 *   { way, total, borders: n, levels: n, zones: [key, ...], steps: [...], crossed: [border, ...] }
 *   zones    every zone on the route, the first and the last included
 *   steps    [{ kind: "border", from: spot, to: spot, zone: key (entered), level, border }, { kind: "level", zone, from: spot, to: spot, level, floor }]
 *            in the order they are taken; `level` is the level one is on after the step
 *   crossed  the borders crossed, in order (borderInfo; `over: true` where a flyer passes over a wall that stops walkers,
 *            `blocked: true` on a "range" route where the border stops walkers)
 * `way`: "range" (borders on the shortest route, walls or not) or a way of moving. Between the ends the route runs at the level the
 * way of moving travels at (walk and swim on the ground, air and swing elevated, through underground: for teleportation, which
 * does not pass through anything, only the ends mean something). null when there is no such route.
 */
export function path(C, keyOf, A, B, way = "walk") {
  const len = way === "range" ? range(C, A, B) : routeLength(C, A, B, way);
  if ( !len || A.area || B.area ) return null;
  const ids = chain(C, A.id, B.id, way);
  if ( !ids ) return null;
  const P = pathAlong(C, keyOf, A, B, way, ids);
  return P && { way, total: len.total, borders: len.borders, levels: len.levels, zones: P.zones, steps: P.steps, crossed: P.crossed };
}

/**
 * The steps along a given chain of zone ids from place A to place B (the first id A's zone, the last B's):
 *   { way, total, borders, edges, levels, zones, steps, crossed }      (total = the number of steps)
 * `links[i]` (optional): the temporary edge that joins ids[i - 1] and ids[i] instead of their border (a step of kind "edge").
 * `stairs: false`: no stairs are walked at the ends (a forced move: the mover goes where it is thrown).
 * A border on the chain that stops this way of moving is marked `blocked: true` (only a chain the route finder did not make can
 * have one: a forced move, a crash through a wall, a chain the GM edited). null: two ids on the chain are joined by nothing.
 */
export function pathAlong(C, keyOf, A, B, way, ids, { links = null, stairs: climbs = true } = {}) {
  if ( !ids?.length ) return null;
  const steps = [], crossed = [], M = C.M;
  const stopWay = way === "swim" || way === "range" ? "walk" : way === "swing" ? "air" : way;
  const spot = (id, level, floor = 0) => spotOf(keyOf(id), level, floor);
  // the levels inside a building, one vertical zone a step: floors, then the rooftop above the top floor
  const rung = (id, h) => { const n = floorsOf(M, id); return h <= 0 ? ["ground", 0] : h > n ? ["elevated", 0] : ["floor", h]; };
  const walks = climbs && (way === "walk" || way === "swim");
  // a place this way of moving cannot be at (a walker in the air, anybody but a burrower underground) has no stairs to it: no
  // plan, as plan() says (the loop below would never end on a climb of null)
  const up = walks ? climb(M, A, way) : 0, down = walks ? climb(M, B, way) : 0;
  if ( !Number.isFinite(up) || !Number.isFinite(down) ) return null;
  const stairs = (id, h0, h1) => {
    for ( let h = h0; h !== h1; ) {
      const [l0, f0] = rung(id, h); h += h1 > h ? 1 : -1; const [l1, f1] = rung(id, h);
      steps.push({ kind: "level", zone: keyOf(id), from: spot(id, l0, f0), to: spot(id, l1, f1), level: l1, floor: f1 });
    }
  };
  const hop = (p, to) => steps.push({ kind: "level", zone: p.zone, from: p.spot, to: to.spot, level: to.level, floor: to.floor });
  if ( ids.length === 1 ) {
    if ( A.spot !== B.spot ) { if ( walks ) stairs(A.id, up, down); else hop(A, B); }
  } else {
    if ( walks ) stairs(A.id, up, 0);
    const travel = TRAVEL[way];
    let at = walks ? spot(A.id, "ground") : A.spot;
    for ( let i = 1; i < ids.length; i++ ) {
      const a = ids[i - 1], b = ids[i], last = i === ids.length - 1;
      const level = last && !walks ? B.level : (travel ?? "ground"), floor = last && !walks ? B.floor : 0;
      const to = last && !walks ? B.spot : spot(b, level);
      const link = links?.[i] ?? null;
      if ( link ) steps.push({ kind: "edge", from: at, to, zone: keyOf(b), level, floor, edge: link });
      else {
        const br = borderInfo(C, keyOf, a, b);
        if ( !br ) return null;
        if ( br.stops[stopWay] ) br.blocked = true;
        else if ( (way === "air" || way === "swing") && br.stops.walk ) br.over = true;
        crossed.push(br);
        steps.push({ kind: "border", from: at, to, zone: keyOf(b), level, floor, border: br });
      }
      at = to;
    }
    if ( walks ) stairs(B.id, 0, down);
  }
  let borders = 0, edges = 0;
  for ( const s of steps ) { if ( s.kind === "border" ) borders++; else if ( s.kind === "edge" ) edges++; }
  return { way, total: steps.length, borders, edges, levels: steps.length - borders - edges, zones: ids.map(keyOf), steps, crossed };
}

/** Zones within `n` of a zone: [{ id, d }] nearest first (way "range" or a way of moving; horizontal borders only). */
export function within(C, from, n, way = "range") {
  if ( from < 0 || !(n >= 0) ) return [];
  const D = way === "range" ? rangeFrom(C, from) : movesFrom(C, from)[way];
  if ( !D ) return [];
  const out = [];
  for ( const [id, d] of D ) if ( d <= n ) out.push({ id, d });
  return out.sort((p, q) => p.d - q.d || p.id - q.id);
}
