import { stopped, isWater, floorsOf } from "./marks.mjs";
import { pointInRing } from "./geometry.mjs";
import { WAYS, climb, chain, pathAlong, rangeFrom } from "./places.mjs";

/**
 * Movement for a combat module (pure, no Foundry) - combat-plan 5.7 items 13-16:
 *  - a MOVER PROFILE (how it moves, how far in one action, how far with the stress option, what conditions it is under) and
 *    what a route costs it;
 *  - which zones it can reach, and the route step by step, temporary edges (states.mjs) included;
 *  - a chain of zones laid along a direction (a forced move: Knockback, Slam, a throw), which a GM may edit;
 *  - a free spot for a token inside a zone;
 *  - the step loop of a move: before every step the listeners are asked, each may take its time (a roll, a prompt) and stop it.
 *
 * What the map works out here is geometry and counting. It never decides what a condition does, what a stop costs, what a wall
 * does to the one thrown into it: the profile says how the mover moves, the listeners say what happens on the way.
 *
 * Book basis for the shapes (book-dump lines): a quick action moves to an adjacent zone, moving inside a zone is free (2383); the
 * movement powers move N zones in one action and twice that for 1 stress (1995, 1999-2002, 2007, 2013, 2021, 2027, 2034); flight
 * may end airborne (2396), leaping and super-speed must end on the ground or a rooftop (2007, 2013); swinging ends only where
 * there is something to hang on (2028); burrowing ignores walls and doors (1995); teleportation does not pass through the space
 * in between (2034); several movers move as one (carrying 2392, a grapple 2497, a group of minions 2826, Teleport Allies 2038).
 */

/** The names a profile may give its way of moving, and the route they count (places.mjs WAYS). */
export const WAY_OF = {
  walk: "walk", ground: "walk", run: "walk",
  air: "air", flight: "air", fly: "air", leap: "air", leaping: "air", superspeed: "air", speed: "air",
  through: "through", burrow: "through", burrowing: "through", teleport: "through", teleportation: "through", phase: "through",
  swim: "swim", swimming: "swim", swing: "swing", swinging: "swing"
};
/** The ways that may not end in the air (book-dump 2007, 2013: the ground or a rooftop). */
const MUST_LAND = new Set(["leap", "leaping", "superspeed", "speed"]);

const posInt = (v, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 1 ? n : d; };

/**
 * A mover profile, filled in:
 *   { way, name, speed, stressSpeed, actions, hover, force, edges, conditions, group }
 *   way          "walk" | "air" | "through" | "swim" | "swing" (the route it counts); `name`: what the caller called it ("leap")
 *   speed        zones in one movement action (1 on foot: book-dump 2383)
 *   stressSpeed  zones in one action with the stress option, null: no option (`stress: true` doubles the speed, as every movement
 *                power of the book does; `stress: n` or `stressSpeed: n` says it outright)
 *   actions      how many movement actions the mover may spend now (what "within reach" is measured against; default 1)
 *   hover        may end in the air (air only; false for leaping and super-speed unless the caller says otherwise)
 *   force        may try borders that stop it (a crash through a wall: 2419): the route then counts every border and marks the
 *                blocked ones; whether it gets through is for the listeners of the step
 *   edges        which temporary edges it may use: true (every one that lets its way through), false, or a list of kinds
 *   conditions   the mover's conditions, as given: the map does not read them, the step listeners get them
 */
export function profileOf(p = {}) {
  if ( typeof p === "string" ) p = { way: p };
  const name = String(p?.way ?? "walk").toLowerCase(), way = WAY_OF[name] ?? null;
  if ( !way ) return null;
  const speed = posInt(p.speed, 1);
  const s = p.stressSpeed ?? (typeof p.stress === "object" ? p.stress?.speed : p.stress);
  const stressSpeed = s === true ? speed * 2 : s == null || s === false ? null : Math.max(speed, posInt(s, speed));
  return {
    way, name, speed, stressSpeed, actions: posInt(p.actions, 1),
    hover: way === "air" ? (typeof p.hover === "boolean" ? p.hover : !MUST_LAND.has(name)) : false,
    force: p.force === true,
    edges: Array.isArray(p.edges) ? p.edges.filter((k) => typeof k === "string") : p.edges !== false,
    conditions: Array.isArray(p.conditions) ? p.conditions.slice() : []
  };
}

/**
 * What a route of `total` steps costs this mover:
 *   { total, speed, actions, stressSpeed, stressActions, within }
 *   actions        movement actions needed without the stress option (0: nothing to pay)
 *   stressActions  with it (null: the mover has no such option)
 *   within         measured against the actions it may spend: "free" (no step), "plain", "stress" (only with the option), "no"
 */
export function costOf(total, prof) {
  const stressActions = prof.stressSpeed ? Math.ceil(total / prof.stressSpeed) : null;
  const actions = Math.ceil(total / prof.speed);
  const within = total === 0 ? "free" : actions <= prof.actions ? "plain" : stressActions != null && stressActions <= prof.actions ? "stress" : "no";
  return { total, speed: prof.speed, actions, stressSpeed: prof.stressSpeed, stressActions, within };
}

/* ---------------------------------------------------------------- the graph a mover moves on */

const stopOf = (way) => (way === "swim" ? "walk" : way === "swing" ? "air" : way);
/** Whether this mover may use an edge (the edge's own `ways`, the profile's `edges`). */
export function edgeOpen(edge, prof) {
  if ( prof.edges === false ) return false;
  if ( Array.isArray(prof.edges) && !prof.edges.includes(edge.kind) ) return false;
  return !edge.ways || edge.ways.includes(prof.way) || edge.ways.includes(prof.name);
}
/** The temporary edges out of a zone that this mover may use: [{ to, edge }]. */
const linksOf = (C, id, prof) => (C.X?.links?.get(id) ?? []).filter((l) => edgeOpen(l.edge, prof));
const usesEdges = (C, prof) => prof.edges !== false && !!C.X?.links?.size;

/**
 * Steps from a zone to every zone this mover can get to: Map id -> steps. A border counts one step, a temporary edge one step
 * (our reading: the book gives a portal or a tunnel no length). Kept per zones state, start, way and what the profile lets through.
 */
export function stepsFrom(C, from, prof) {
  const key = `${from}|${prof.way}|${prof.force ? 1 : 0}|${prof.edges === false ? "-" : Array.isArray(prof.edges) ? prof.edges.join() : `*${prof.name}`}`;
  let d = C.steps.get(key);
  if ( d ) return d;
  C.steps.set(key, d = new Map());
  if ( !C.Z || from < 0 || !C.Z.adj.has(from) ) return d;
  const stop = stopOf(prof.way), swim = prof.way === "swim", edges = usesEdges(C, prof);
  d.set(from, 0);
  const q = [from];
  for ( let k = 0; k < q.length; k++ ) {
    const a = q[k], n = d.get(a) + 1;
    for ( const b of C.Z.adj.get(a).keys() ) {
      if ( d.has(b) || (!prof.force && stopped(C.M, a, b, stop)) || (swim && !isWater(C.M, b)) ) continue;
      d.set(b, n); q.push(b);
    }
    if ( edges ) for ( const l of linksOf(C, a, prof) ) {
      if ( d.has(l.to) || (swim && !isWater(C.M, l.to)) ) continue;
      d.set(l.to, n); q.push(l.to);
    }
  }
  return d;
}

/** Whether a route of this mover may END in a zone (swinging: a standing building or tall features - book-dump 2028). */
function mayEnd(C, id, prof, from) {
  if ( prof.way !== "swing" || id === from ) return true;
  const p = C.M?.zones.get(id);
  return !!(p?.tall || (p?.building && !p.wrecked));
}

/**
 * The zone ids of this mover's shortest route and the edges it takes: { ids, links } (links[i]: the edge between ids[i - 1] and
 * ids[i], null: their border). Ties go through the lowest zone id, a border before an edge. null: no route.
 */
export function routeOf(C, from, to, prof) {
  if ( from < 0 || to < 0 ) return null;
  if ( from === to ) return { ids: [from], links: [null] };
  const D = stepsFrom(C, from, prof);
  if ( !D.has(to) || !mayEnd(C, to, prof, from) ) return null;
  const stop = stopOf(prof.way), swim = prof.way === "swim", edges = usesEdges(C, prof);
  const ids = [to], links = [];
  for ( let cur = to; cur !== from; ) {
    const d = D.get(cur);
    let prev = -1, link = null;
    if ( !swim || isWater(C.M, cur) ) {
      for ( const n of C.Z.adj.get(cur).keys() ) if ( D.get(n) === d - 1 && (prof.force || !stopped(C.M, n, cur, stop)) && (prev < 0 || n < prev) ) prev = n;
      if ( edges ) for ( const l of linksOf(C, cur, prof) ) if ( D.get(l.to) === d - 1 && (prev < 0 || l.to < prev) ) { prev = l.to; link = l.edge; }
    }
    if ( prev < 0 ) return null;
    ids.push(prev); links.push(link); cur = prev;
  }
  links.push(null);
  return { ids: ids.reverse(), links: links.reverse() };
}

/**
 * The move of this mover from place A to place B, step by step, with what it costs:
 *   { way, name, total, borders, edges, levels, zones, steps, crossed, cost, from, end }
 * as places.mjs path() (steps of kind "border" | "level" | "edge"), `cost` = costOf(total), `from` / `end` the two places.
 * A blocked border on the route (only with `force`) carries `blocked: true` on its step's border.
 * null: no way (an off-map end, an unknown place, no route, a place this way of moving cannot be at, an end in the air for a
 * mover that must land).
 */
export function plan(C, keyOf, A, B, prof) {
  if ( !A || !B || A.area || B.area || A.id < 0 || B.id < 0 || !prof || !WAYS.includes(prof.way) ) return null;
  if ( B.airborne && !(prof.way === "air" && prof.hover) && !(A.airborne && A.spot === B.spot) && !(prof.way === "swing" || prof.way === "through") ) return null;
  if ( climb(C.M, A, prof.way) == null || climb(C.M, B, prof.way) == null ) return null;
  const R = routeOf(C, A.id, B.id, prof);
  if ( !R ) return null;
  const P = pathAlong(C, keyOf, A, B, prof.way, R.ids, { links: R.links });
  return P && { ...P, name: prof.name, cost: costOf(P.total, prof), from: A, end: B };
}

/**
 * The steps along a chain of zone ids somebody chose (a forced move, a chain the GM edited): as plan(), with the borders that stop
 * this way of moving marked `blocked`. Two zones on the chain that are not neighbours are joined by a temporary edge the mover may
 * use, when there is one. `stairs: false` for a forced move (nobody walks the stairs while thrown).
 * null: two zones on the chain are joined by nothing, or the chain does not start in A's zone.
 */
export function planAlong(C, keyOf, A, ids, prof, B, { stairs = true } = {}) {
  if ( !A || !B || A.id < 0 || !ids?.length || ids[0] !== A.id || ids[ids.length - 1] !== B.id ) return null;
  const links = [null];
  for ( let i = 1; i < ids.length; i++ ) {
    if ( C.Z.adj.get(ids[i - 1])?.has(ids[i]) ) { links.push(null); continue; }
    const l = linksOf(C, ids[i - 1], prof).find((x) => x.to === ids[i]);
    if ( !l ) return null;
    links.push(l.edge);
  }
  const P = pathAlong(C, keyOf, A, B, prof.way, ids, { links, stairs });
  return P && { ...P, name: prof.name, cost: costOf(P.total, prof), from: A, end: B };
}

/**
 * Where this mover can get to: [{ id, d, cost }] nearest first (horizontal steps from its zone; `max`: no farther than this many).
 * The zone it stands in is the first row (d 0).
 */
export function reach(C, from, prof, max = Infinity) {
  if ( from < 0 || !prof ) return [];
  const out = [];
  for ( const [id, d] of stepsFrom(C, from, prof) ) if ( d <= max && mayEnd(C, id, prof, from) ) out.push({ id, d, cost: costOf(d, prof) });
  return out.sort((p, q) => p.d - q.d || p.id - q.id);
}

/* ---------------------------------------------------------------- a chain along a direction (forced moves) */

/**
 * The zones a straight line from a point crosses: { ids, points, end }.
 *   ids     the zone the point lies in, then every zone entered, at most `n` of them after the first
 *   points  where each zone was entered: [{ x, y }] (the start point first)
 *   end     "distance" (n zones crossed) | "edge" (the line left the zones: the map's edge, or ground nobody drew a zone on)
 * `dir`: { dx, dy } (any length). Two zones the line passes between without their sharing a border (a corner, a sliver) are
 * joined by the shortest chain of borders. null: the point is in no zone, or no direction.
 * @param {(x: number, y: number) => number} zoneAt
 * @param {number} step      how far apart the line is sampled (scene px; a quarter of a grid square is plenty)
 * @param {number} reachPx   how far the line is followed at most
 */
export function rayChain(C, zoneAt, from, dir, n, step, reachPx) {
  const L = Math.hypot(dir?.dx ?? 0, dir?.dy ?? 0), start = zoneAt(from.x, from.y);
  if ( !(L > 0) || start < 0 || !(n >= 0) ) return null;
  const ux = dir.dx / L, uy = dir.dy / L, ids = [start], points = [{ x: from.x, y: from.y }];
  let cur = start, gap = 0;
  for ( let t = step; t <= reachPx && ids.length - 1 < n; t += step ) {
    const x = from.x + ux * t, y = from.y + uy * t, id = zoneAt(x, y);
    if ( id === cur ) { gap = 0; continue; }
    // (a sample on a line between zones reads as no zone: only a stretch of them is the end of the zones)
    if ( id < 0 ) { gap += step; if ( gap > step * 6 ) return { ids, points, end: "edge" }; continue; }
    gap = 0;
    const hop = C.Z.adj.get(cur)?.has(id) ? [cur, id] : chain(C, cur, id, "range");
    if ( !hop ) return { ids, points, end: "edge" };
    for ( let i = 1; i < hop.length && ids.length - 1 < n; i++ ) { ids.push(hop[i]); points.push({ x, y }); }
    cur = ids[ids.length - 1];
    if ( cur !== id ) break;
  }
  return { ids, points, end: ids.length - 1 >= n ? "distance" : "edge" };
}

/** How many borders lie between the zones of a chain and the start (the range count: a check for an edited chain). */
export const chainRange = (C, ids) => (ids?.length ? (rangeFrom(C, ids[0]).get(ids[ids.length - 1]) ?? null) : null);

/* ---------------------------------------------------------------- a chain up or down (a forced move between levels) */

/**
 * The rungs of one zone, bottom to top: underground (-1), the ground (0), the floors of a standing building (1..n), the elevated
 * position above it (n + 1: the rooftop, or the air at that height). The rung a place is on:
 */
export function rungOf(M, p) {
  if ( !p || p.area || p.id < 0 ) return null;
  return p.level === "underground" ? -1 : p.level === "floor" ? p.floor : p.level === "elevated" ? floorsOf(M, p.id) + 1 : 0;
}
/** The top rung of a zone (the elevated position). */
export const topRung = (M, id) => floorsOf(M, id) + 1;
const rungSpot = (key, n, h) => (h < 0 ? `${key}:underground` : h === 0 ? key : h > n ? `${key}:elevated` : `${key}:f${h}`);
/**
 * What lies between two neighbouring rungs of a zone: "ground" (between underground and the surface), "floor" (a storey's floor
 * inside a standing building), "roof" (between the top storey - or the ground of a plain building - and its rooftop), null (open
 * air: no building, or a wrecked one).
 */
export function slabOf(M, id, lo) {
  if ( lo < 0 ) return "ground";
  const p = M?.zones.get(id);
  if ( !p?.building || p.wrecked ) return null;
  return lo >= floorsOf(M, id) ? "roof" : "floor";
}
/**
 * The steps from a place straight up or down inside its own zone to another rung, one vertical zone a step:
 *   [{ kind: "level", zone, from: spot, to: spot, level, floor, dir: 1 | -1, slab }]
 * `slab`: what the step passes through (slabOf). The map only says it is there: what it does to the mover is the listeners'.
 */
export function levelSteps(M, keyOf, A, target) {
  const h0 = rungOf(M, A), steps = [];
  if ( h0 == null ) return steps;
  const n = floorsOf(M, A.id), key = keyOf(A.id), dir = target > h0 ? 1 : -1;
  for ( let h = h0; h !== target; h += dir ) {
    const to = h + dir;
    steps.push({ kind: "level", zone: key, from: rungSpot(key, n, h), to: rungSpot(key, n, to), level: to < 0 ? "underground" : to === 0 ? "ground" : to > n ? "elevated" : "floor", floor: to > 0 && to <= n ? to : 0, dir, slab: slabOf(M, A.id, Math.min(h, to)) });
  }
  return steps;
}
/**
 * A chain straight up or down from a place, `n` vertical zones at most: { steps, rung, end }.
 *   end   "distance" (n zones passed) | "top" (nothing above the elevated position: sky high is off the map - book-dump 2259) |
 *         "ground" (down ends on the ground: nobody is thrown underground - our reading; only burrowing goes there, 1995)
 * Up from underground comes out on the ground and goes on. null: the place is in no zone, or no direction.
 */
export function riseChain(M, keyOf, A, dir, n) {
  const h0 = rungOf(M, A);
  if ( h0 == null || !(dir === 1 || dir === -1) || !(n >= 0) ) return null;
  const limit = dir > 0 ? topRung(M, A.id) : Math.min(h0, 0);
  const target = dir > 0 ? Math.min(limit, h0 + n) : Math.max(limit, h0 - n);
  const steps = levelSteps(M, keyOf, A, target);
  return { steps, rung: target, end: steps.length >= n ? "distance" : dir > 0 ? "top" : "ground" };
}
/** A plan out of level steps inside one zone (the shape plan() gives), for a mover profile. */
export function planOfLevels(keyOf, A, B, prof, steps) {
  return { way: prof.way, name: prof.name, total: steps.length, borders: 0, edges: 0, levels: steps.length, zones: [keyOf(A.id)], steps, crossed: [], cost: costOf(steps.length, prof), from: A, end: B };
}

/* ---------------------------------------------------------------- a free spot inside a zone */

const inZone = (zone, x, y) => zone.parts.some((part) => pointInRing(part[0], x, y) && !part.slice(1).some((h) => pointInRing(h, x, y)));

/**
 * Where a token of `w` x `h` scene pixels can stand inside a zone without covering another: the top-left corner { x, y, crowded }.
 *   taken    the other tokens: [{ x, y, w, h }] (top-left and size, scene px)
 *   near     the point to stay close to (where it came in, where it was dropped); default: the middle of the zone
 *   grid     the grid square (candidates lie on the grid, as dropped tokens do); `origin`: a grid corner (default 0, 0)
 * The spot lies wholly inside the zone when one does; else one whose middle is inside; when every such spot is taken the least
 * covered one is given with `crowded: true`. A zone too small for any spot: its middle, crowded.
 */
export function freeSpot(zone, { w, h, taken = [], near = null, grid = 100, origin = { x: 0, y: 0 } } = {}) {
  const g = Math.max(1, grid), o = zone.parts[0][0];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for ( const part of zone.parts ) for ( let i = 0, r = part[0]; i < r.length; i += 2 ) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); }
  const at = near ?? { x: zone.label?.x ?? o[0], y: zone.label?.y ?? o[1] };
  const inset = Math.min(w, h) * 0.12;
  const over = (x, y) => { let n = 0; for ( const t of taken ) if ( x < t.x + t.w - 1 && t.x < x + w - 1 && y < t.y + t.h - 1 && t.y < y + h - 1 ) n++; return n; };
  let best = null;
  const gx0 = Math.floor((x0 - origin.x) / g) - 1, gx1 = Math.ceil((x1 - origin.x) / g), gy0 = Math.floor((y0 - origin.y) / g) - 1, gy1 = Math.ceil((y1 - origin.y) / g);
  for ( let j = gy0; j <= gy1; j++ ) for ( let i = gx0; i <= gx1; i++ ) {
    const x = origin.x + i * g, y = origin.y + j * g, cx = x + w / 2, cy = y + h / 2;
    if ( !inZone(zone, cx, cy) ) continue;
    const whole = inZone(zone, x + inset, y + inset) && inZone(zone, x + w - inset, y + inset) && inZone(zone, x + inset, y + h - inset) && inZone(zone, x + w - inset, y + h - inset);
    const row = { x, y, n: over(x, y), whole, d: Math.hypot(cx - at.x, cy - at.y) };
    // free before covered, wholly inside before half out, near before far, then reading order (the same on every client)
    if ( !best || row.n < best.n || (row.n === best.n && (row.whole > best.whole || (row.whole === best.whole && (row.d < best.d - 1e-6 || (Math.abs(row.d - best.d) <= 1e-6 && (y < best.y || (y === best.y && x < best.x))))))) ) best = row;
  }
  if ( !best ) { const c = zone.label ?? { x: o[0], y: o[1] }; return { x: c.x - w / 2, y: c.y - h / 2, crowded: true }; }
  return { x: best.x, y: best.y, crowded: best.n > 0 };
}

/* ---------------------------------------------------------------- the step loop */

/**
 * Take a move step by step. Before each step every listener is asked, one after another, and may take as long as it needs (a
 * promise): a roll, a prompt, a change of the map. What a listener answers:
 *   nothing / true          go on
 *   false                   stop here (the step is not taken)
 *   { stop: true, reason, data }   stop here, saying why
 *   { pass: true }          take the step although its border is blocked (a wall phased through)
 * A listener that throws stops the move (reason "error"): a move never goes on past a check that broke.
 * After the listeners the step's border is looked at again (`blocked(step)`, as it is NOW: a listener may have breached it); a
 * blocked border that nobody passed stops the move (reason "blocked").
 *
 * @param {object} o
 * @param {object[]} o.steps                         the plan's steps
 * @param {Function[]} o.listeners                   (ctx) => answer | Promise<answer>
 * @param {(step, index) => object} o.context        what the listeners get for a step (the caller adds token, profile, places)
 * @param {(step, index) => boolean} [o.blocked]     whether the step cannot be taken as the map is now
 * @param {(step, index) => Promise} o.perform       take the step (move the tokens)
 * @param {(step, index) => void} [o.after]          told after each step taken
 * @returns {Promise<{ done: number, stopped: null | { index, reason, data, step } }>}
 */
export async function runSteps({ steps, listeners = [], context, blocked = null, perform, after = null }) {
  let done = 0;
  for ( let i = 0; i < steps.length; i++ ) {
    const step = steps[i], ctx = context(step, i);
    let pass = false, stop = null;
    for ( const fn of [...listeners] ) {
      let r;
      try { r = await fn(ctx); }
      catch ( err ) { r = { stop: true, reason: "error", data: { error: String(err?.message ?? err) } }; }
      if ( r === false ) r = { stop: true };
      if ( r?.stop ) { stop = { index: i, reason: r.reason ?? null, data: r.data ?? null, step }; break; }
      if ( r?.pass ) pass = true;
    }
    if ( !stop && !pass && blocked?.(step, i) ) stop = { index: i, reason: "blocked", data: null, step };
    if ( stop ) return { done, stopped: stop };
    await perform(step, i);
    done++;
    after?.(step, i);
  }
  return { done, stopped: null };
}
