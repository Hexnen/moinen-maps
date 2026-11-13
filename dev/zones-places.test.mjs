// Zones: places in three dimensions, the two distances, routes, borders and zones as data.   node dev/zones-places.test.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
const G = await imp("scripts/zones/geometry.mjs");
const K = await imp("scripts/zones/marks.mjs");
const P = await imp("scripts/zones/places.mjs");

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if ( !ok ) failed++; };
const J = JSON.stringify;

// a row of four zones: 0 | 1 | 2 | 3   (frame 0..400 x 0..100, dividers at 100, 200, 300); keys a, b, c, d
const Z = G.buildZones([[-20, 0, 420, 0], [-20, 100, 420, 100], [0, -20, 0, 120], [400, -20, 400, 120], [100, -20, 100, 120], [200, -20, 200, 120], [300, -20, 300, 120]], { snap: 5, minArea: 100 });
const zoneAt = (x, y) => G.zoneAt(Z, x, y);
const keyOf = (id) => "abcd"[id] ?? null;
const world = (walls = [], marks = []) => { const M = K.resolve(Z, walls, marks, zoneAt, 35); return { M, C: P.makeCache(Z, M), at: (id, o = {}) => P.makePlace(M, keyOf, { id, ...o }) }; };

/* ---- places */
// zone 1: a building with 3 floors; zone 2: a plain building; zone 3: a wrecked building
let W = world([], [[150, 50, { building: true, floors: 3 }], [250, 50, { building: true }], [350, 50, { building: true, wrecked: true }]]);
let p = W.at(0);
check(p.zone === "a" && p.spot === "a" && p.level === "ground" && !p.area && !p.airborne && !p.roof, "ground: the spot is the zone key");
p = W.at(1, { floor: 2 });
check(p.level === "floor" && p.floor === 2 && p.spot === "b:f2", "a floor of a building with floors");
check(W.at(1, { floor: 9 }).level === "ground" && W.at(0, { floor: 2 }).level === "ground", "a floor the building does not have is the ground");
p = W.at(2, { alt: "elevated" });
check(p.level === "elevated" && p.roof && !p.airborne && p.spot === "c:elevated", "elevated over a standing building: on its rooftop");
p = W.at(2, { alt: "elevated", air: true });
check(p.airborne && !p.roof && p.spot === "c:elevated" && P.placeSig(p) !== P.placeSig(W.at(2, { alt: "elevated" })), "... or in the air above it, the same zone by the book but told apart");
check(W.at(3, { alt: "elevated" }).airborne && W.at(0, { alt: "elevated" }).airborne, "no rooftop over a wrecked building or open ground: airborne");
p = W.at(1, { alt: "sky", floor: 2 });
check(p.zone === "@sky" && p.spot === "@sky" && p.area === "sky" && p.level === null && p.id === -1 && p.below === "b", "sky high: off the map, one zone, the zone below remembered");
check(P.AREAS.map((a) => W.at(0, { alt: a }).spot).join() === "@sky,@orbit,@dimension,@chase", "the four areas off the map");
check(W.at(0, { alt: "underground" }).spot === "a:underground" && W.at(-1).zone === null && W.at(-1).spot === null, "underground; outside every zone");
check(J(["a", "a:elevated", "b:f2", "a:underground", "@orbit", "a:nope", "@moon", ""].map((s) => { const r = P.parseSpot(s); return r ? [r.key, r.alt, r.floor] : null; }))
  === J([["a", "ground", 0], ["a", "elevated", 0], ["b", "ground", 2], ["a", "underground", 0], ["@orbit", "orbit", 0], null, null, null]), "spot strings parse back");
check(P.sameSpot(W.at(2, { alt: "elevated" }), W.at(2, { alt: "elevated", air: true })) && !P.sameSpot(W.at(2), W.at(2, { alt: "elevated" })), "all elevated in one horizontal zone are in the same zone (book-dump 2258)");

/* ---- range: borders on the shortest route, blocked ones too; levels on top */
W = world([[100, 50, "wall"], [200, 50, "locked"]], [[150, 50, { building: true, floors: 3 }], [250, 50, { building: true }]]);
check(J(P.range(W.C, W.at(0), W.at(3))) === J({ borders: 3, levels: 0, total: 3 }) && P.routeLength(W.C, W.at(0), W.at(3), "walk") === null, "a wall is still a border for range (2254-2255), and no way for walking");
check(P.range(W.C, W.at(0), W.at(0)).total === 0, "same zone: 0");
check(P.range(W.C, W.at(0), W.at(3, { alt: "elevated" })).total === 4 && P.range(W.C, W.at(0), W.at(0, { alt: "elevated" })).total === 1, "ground to elevated: one more (2258)");
check(P.range(W.C, W.at(0, { alt: "elevated" }), W.at(3, { alt: "elevated" })).total === 3 && P.range(W.C, W.at(2, { alt: "elevated" }), W.at(3, { alt: "elevated" })).levels === 0, "two elevated: horizontal only");
check(P.range(W.C, W.at(1, { floor: 3 }), W.at(0)).total === 4 && P.range(W.C, W.at(1, { floor: 1 }), W.at(1, { floor: 3 })).total === 2, "floors are vertical zones (2262)");
check(P.range(W.C, W.at(1), W.at(1, { alt: "elevated" })).total === 4 && P.range(W.C, W.at(0), W.at(1, { alt: "elevated" })).total === 2, "a rooftop is above the top floor from inside, one zone up from outside (2419)");
check(P.range(W.C, W.at(0, { alt: "sky" }), W.at(0)) === null && P.range(W.C, W.at(0, { alt: "sky" }), W.at(0, { alt: "orbit" })) === null && P.range(W.C, W.at(0, { alt: "sky" }), W.at(3, { alt: "sky" })).total === 0, "off the map: no range in or out, 0 inside the area (2259-2260)");
check(P.range(W.C, W.at(-1), W.at(0)) === null, "outside every zone: no range");

/* ---- routes per way of moving */
check(J(P.routeLength(W.C, W.at(0), W.at(3), "through")) === J({ borders: 3, levels: 0, total: 3 }) && P.routeLength(W.C, W.at(0), W.at(1), "air").total === 1 && P.routeLength(W.C, W.at(1), W.at(2), "air") === null,
  "burrowing passes every wall; from outside a flyer passes over a building whatever its wall (A14); a locked door between two buildings stops flight");
W = world([[100, 50, "outer"], [200, 50, "door"]], [[150, 50, { building: true, floors: 3 }], [250, 50, { building: true }], [350, 50, { water: true }]]);
check(P.routeLength(W.C, W.at(0), W.at(1), "walk") === null && P.routeLength(W.C, W.at(0), W.at(2), "air").total === 2, "an exterior wall: over the top by air only");
check(J(P.routeLength(W.C, W.at(1, { floor: 2 }), W.at(3), "walk")) === J({ borders: 2, levels: 2, total: 4 }), "walking down from floor 2 first");
check(P.routeLength(W.C, W.at(1, { floor: 2 }), W.at(3), "air").total === 2 && P.routeLength(W.C, W.at(1, { floor: 2 }), W.at(3), "through").total === 2, "flight and teleportation do not count the stairs");
check(P.routeLength(W.C, W.at(3), W.at(2, { alt: "elevated" }), "walk").total === 2 && P.routeLength(W.C, W.at(2), W.at(2, { alt: "elevated" }), "walk").total === 1, "a plain building is one zone: its rooftop is one move up (2404)");
check(P.routeLength(W.C, W.at(1), W.at(1, { alt: "elevated" }), "walk").total === 4 && P.routeLength(W.C, W.at(1, { floor: 1 }), W.at(1, { floor: 3 }), "walk").total === 2, "inside a building with floors: one zone a floor, the roof above the top one");
check(P.routeLength(W.C, W.at(2), W.at(3, { alt: "elevated" }), "walk") === null && P.routeLength(W.C, W.at(3, { alt: "elevated" }), W.at(2), "walk") === null && P.routeLength(W.C, W.at(2), W.at(3, { alt: "elevated" }), "air").total === 1, "walking cannot reach or leave the air; flying changes level as part of the move (2385)");
check(P.routeLength(W.C, W.at(0), W.at(0, { alt: "elevated" }), "air").total === 1 && P.routeLength(W.C, W.at(0), W.at(0), "air").total === 0, "same zone, another level: one move for a flyer");
check(P.routeLength(W.C, W.at(2), W.at(3), "swim").total === 1 && P.routeLength(W.C, W.at(3), W.at(2), "swim") === null, "swimming only into water");
check(P.routeLength(W.C, W.at(3), W.at(2), "swing").total === 1 && P.routeLength(W.C, W.at(2), W.at(3), "swing") === null, "swinging ends on a building");
check(P.routeLength(W.C, W.at(0), W.at(2, { alt: "underground" }), "through").total === 2 && P.routeLength(W.C, W.at(0), W.at(2, { alt: "underground" }), "walk") === null && P.routeLength(W.C, W.at(0), W.at(2, { alt: "underground" }), "air") === null, "only burrowing goes underground (1995)");
check(P.routeLength(W.C, W.at(0, { alt: "sky" }), W.at(2), "air") === null && P.routeLength(W.C, W.at(0), W.at(2), "hop") === null, "no route to or from off the map (a full action, not a distance: 2386-2387); unknown way");

/* ---- path: zones, levels, borders */
let r = P.path(W.C, keyOf, W.at(1, { floor: 2 }), W.at(3), "walk");
check(r && r.zones.join() === "b,c,d" && r.total === 4 && r.steps.length === 4 && r.steps.map((s) => s.kind).join() === "level,level,border,border", `walk path: ${r?.zones} in ${r?.steps.length} steps`);
check(r.steps.map((s) => s.to).join() === "b:f1,b,c,d" && r.crossed.map((b) => `${b.key}:${b.kind}`).join() === "b|c:door,c|d:open", `walk path: ${r.steps.map((s) => s.to)}; ${r.crossed.map((b) => `${b.key}:${b.kind}`)}`);
r = P.path(W.C, keyOf, W.at(0), W.at(2, { alt: "elevated" }), "air");
check(r.zones.join() === "a,b,c" && r.crossed[0].over === true && !r.crossed[1].over && r.steps.map((s) => `${s.to}`).join() === "b:elevated,c:elevated" && r.steps[1].level === "elevated", "air path: over the exterior wall, elevated on the way, ends on the rooftop");
r = P.path(W.C, keyOf, W.at(0), W.at(3), "range");
check(r.total === 3 && r.crossed[0].blocked === true && r.crossed.length === 3 && r.borders === 3, "range path: blocked borders are crossed and marked");
r = P.path(W.C, keyOf, W.at(3), W.at(2, { alt: "elevated" }), "walk");
check(r.steps.map((s) => s.to).join() === "c,c:elevated" && r.steps[1].kind === "level", "walk path up to a rooftop: into the building, then up");
r = P.path(W.C, keyOf, W.at(1), W.at(1, { alt: "elevated" }), "walk");
check(r.steps.map((s) => s.to).join() === "b:f1,b:f2,b:f3,b:elevated" && r.zones.join() === "b" && r.crossed.length === 0, "walk path inside a tall building: floor by floor");
r = P.path(W.C, keyOf, W.at(0), W.at(0, { alt: "elevated" }), "air");
check(r.total === 1 && r.steps.length === 1 && r.steps[0].kind === "level" && r.steps[0].to === "a:elevated", "a level change alone is one step");
r = P.path(W.C, keyOf, W.at(0), W.at(0), "walk");
check(r.total === 0 && r.steps.length === 0 && r.zones.join() === "a", "the same place: an empty path");
check(P.path(W.C, keyOf, W.at(0), W.at(1), "walk") === null && P.path(W.C, keyOf, W.at(0, { alt: "sky" }), W.at(1), "range") === null, "no path where there is no way");
for ( const way of ["range", ...P.WAYS] ) for ( let a = 0; a < 4; a++ ) for ( let b = 0; b < 4; b++ ) {
  const A = W.at(a), B = W.at(b), q = P.path(W.C, keyOf, A, B, way), len = way === "range" ? P.range(W.C, A, B) : P.routeLength(W.C, A, B, way);
  if ( !!q !== !!len || (q && (q.steps.length !== len.total || q.zones[0] !== A.zone || q.zones.at(-1) !== B.zone)) ) check(false, `path and distance disagree: ${way} ${a}->${b}`);
}
check(true, "path and distance agree for every pair and way (steps = total, ends = the places)");

// a 2x2 block: two shortest routes around the corner - the one through the lowest id, every time
const Z4 = G.buildZones([[0, 0, 200, 0, 200, 200, 0, 200, 0, 0], [100, 0, 100, 200], [0, 100, 200, 100]], { snap: 2, minArea: 100 });
const C4 = P.makeCache(Z4, K.resolve(Z4, [], [], (x, y) => G.zoneAt(Z4, x, y), 35));
const a4 = G.zoneAt(Z4, 50, 50), d4 = G.zoneAt(Z4, 150, 150);
const c4 = P.chain(C4, a4, d4, "walk");
check(Z4.zones.length === 4 && c4.length === 3 && c4[1] === Math.min(G.zoneAt(Z4, 150, 50), G.zoneAt(Z4, 50, 150)) && J(P.chain(C4, a4, d4, "range")) === J(c4), `ties go to the lowest id (${c4})`);

/* ---- borders and zones as data */
let b = P.borderInfo(W.C, keyOf, 1, 0);
check(b.key === "a|b" && J(b.zones) === J(["b", "a"]) && b.kind === "outer" && b.armor === 3 && !b.door && b.stops.walk && !b.stops.air && Math.abs(b.length - 100) < 1 && Math.abs(b.x - 100) < 1, `border: ${b.key} ${b.kind} armor ${b.armor}`);
b = P.borderInfo(W.C, keyOf, 1, 2);
check(b.kind === "door" && b.door && b.armor === 1 && !b.stops.walk && P.borderInfo(W.C, keyOf, 2, 3).kind === "open" && P.borderInfo(W.C, keyOf, 2, 3).armor === 0, "a door; an open border");
check(P.borderInfo(W.C, keyOf, 0, 2) === null && P.borderKey("z10", "z9") === "z10|z9" && P.borderKey("z9", "z10") === "z10|z9", "not neighbours: null; a border key does not depend on the order");
W = world([], [[50, 50, { terrain: "street", tags: ["metal", "bystanders"], tall: true }], [150, 50, { terrain: "none", empty: true }], [250, 50, { building: true, floors: 2, terrain: "building", wrecked: true, fire: 7 }], [350, 50, { water: true }]]);
let z = P.zoneInfo(W.C, keyOf, 0);
check(z.key === "a" && J(z.wreck) === J({ can: true, strength: 6, bonus: 3, why: null }) && J(z.tags) === J(["tall", "metal", "bystanders"]) && !z.empty && J(z.neighbours) === J(["b"]), `zone a: wreck ${J(z.wreck)}, tags ${z.tags}`);
z = P.zoneInfo(W.C, keyOf, 1);
check(z.empty && z.wreck.can === false && z.wreck.why === "terrain" && z.terrain === "none", "an empty zone that cannot be wrecked");
z = P.zoneInfo(W.C, keyOf, 2);
check(z.building && !z.rooftop && z.floors === 0 && z.wreck.can === false && z.wreck.why === "wrecked" && z.states.wrecked && z.states.fire === 7, "a wrecked building: no rooftop, no floors, cannot be wrecked again");
z = P.zoneInfo(W.C, keyOf, 3);
check(z.wreck.can === null && z.wreck.why === "unset" && J(z.tags) === J(["water"]) && P.zoneInfo(W.C, keyOf, 9) === null, "no terrain set: the GM decides; water is a resource; an unknown id");

/* ---- zones within */
W = world([[100, 50, "wall"]]);
check(J(P.within(W.C, 0, 2)) === J([{ id: 0, d: 0 }, { id: 1, d: 1 }, { id: 2, d: 2 }]) && J(P.within(W.C, 0, 2, "walk")) === J([{ id: 0, d: 0 }]) && P.within(W.C, 0, 9, "through").length === 4 && P.within(W.C, -1, 2).length === 0, "zones within: by range and by a way of moving");

/* ---- the cache gives what the uncached functions give */
check(J([...P.rangeFrom(W.C, 1)]) === J([...G.distances(Z, 1)]) && P.rangeFrom(W.C, 1) === P.rangeFrom(W.C, 1) && J([...P.movesFrom(W.C, 0).walk]) === J([...K.moveDistances(Z, 0, W.M).walk]), "cached distances equal the direct ones, and are worked out once");

console.log(failed ? `${failed} failed` : "all zones places checks passed");
process.exit(failed ? 1 : 0);
