// Zones: movement for a combat module (pure): mover profiles and cost, reach, routes with temporary edges, chains along a
// direction, free spots, the step loop with listeners that answer later.   node dev/zones-moves.test.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
const G = await imp("scripts/zones/geometry.mjs");
const K = await imp("scripts/zones/marks.mjs");
const P = await imp("scripts/zones/places.mjs");
const S = await imp("scripts/zones/states.mjs");
const Mv = await imp("scripts/zones/moves.mjs");

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if ( !ok ) failed++; };
const J = JSON.stringify;

/* ---- profiles and cost */
let pr = Mv.profileOf();
check(pr.way === "walk" && pr.speed === 1 && pr.stressSpeed === null && pr.actions === 1 && pr.edges === true && !pr.force && !pr.hover, "no profile: on foot, one zone an action (book-dump 2383)");
pr = Mv.profileOf({ way: "flight", speed: 4, stress: true, conditions: ["crushedLeg"] });
check(pr.way === "air" && pr.name === "flight" && pr.speed === 4 && pr.stressSpeed === 8 && pr.hover === true && J(pr.conditions) === J(["crushedLeg"]), "flight 4 / 8 with stress; may end in the air; conditions carried as given");
check(Mv.profileOf({ way: "leap" }).hover === false && Mv.profileOf({ way: "superspeed" }).way === "air" && Mv.profileOf({ way: "leap", hover: true }).hover === true, "leaping and super-speed must land unless the caller says otherwise (2007, 2013)");
check(Mv.profileOf("burrow").way === "through" && Mv.profileOf({ way: "teleport" }).way === "through" && Mv.profileOf({ way: "swinging" }).way === "swing" && Mv.profileOf({ way: "hop" }) === null, "the names of the ways; an unknown one is no profile");
check(Mv.profileOf({ speed: 2, stress: { speed: 4 } }).stressSpeed === 4 && Mv.profileOf({ speed: 2, stressSpeed: 1 }).stressSpeed === 2 && Mv.profileOf({ speed: 0 }).speed === 1 && Mv.profileOf({ edges: ["tunnel", 3] }).edges.join() === "tunnel", "stress speed given outright; never below the speed; bad numbers fall back");
const c = (t, p) => Mv.costOf(t, Mv.profileOf(p));
check(c(0, {}).within === "free" && c(0, {}).actions === 0 && c(1, {}).within === "plain" && c(2, {}).within === "no" && c(2, {}).actions === 2 && c(2, { actions: 2 }).within === "plain", "cost on foot: a zone an action");
check(c(3, { way: "air", speed: 2, stress: true }).within === "stress" && c(3, { way: "air", speed: 2, stress: true }).stressActions === 1 && c(3, { way: "air", speed: 2, stress: true }).actions === 2 && c(5, { way: "air", speed: 2, stress: true }).within === "no" && c(2, { way: "air", speed: 2 }).stressActions === null,
  "cost with a power: within one action, only with the stress option, or not at all");

/* ---- a row of five zones 0 | 1 | 2 | 3 | 4 (keys a..e), 100 px each, with a second row under 1..2: 5 (under 1), 6 (under 2) */
const Z = G.buildZones([[-20, 0, 520, 0], [-20, 100, 520, 100], [0, -20, 0, 120], [500, -20, 500, 120], [100, -20, 100, 220], [200, -20, 200, 220], [300, -20, 300, 220], [400, -20, 400, 120], [80, 200, 320, 200]], { snap: 5, minArea: 100 });
const zoneAt = (x, y) => G.zoneAt(Z, x, y);
const NAMES = "abcdefg";
const keyOf = (id) => NAMES[id] ?? null, idOf = (k) => NAMES.indexOf(k);
const id = { a: zoneAt(50, 50), b: zoneAt(150, 50), c: zoneAt(250, 50), d: zoneAt(350, 50), e: zoneAt(450, 50), f: zoneAt(150, 150), g: zoneAt(250, 150) };
check(Z.zones.length === 7 && J(Object.values(id)) === J([0, 1, 2, 3, 4, 5, 6]), `the test map: ${Z.zones.length} zones, ids ${Object.values(id)}`);
const world = (walls = [], marks = [], plays = [], edges = []) => {
  const M = K.resolve(Z, walls, marks, zoneAt, 35, plays), E = S.resolveEdges(edges, idOf);
  return { M, C: P.makeCache(Z, M, { links: E.links, states: new Map(), own: M.zones, map: new Map() }), at: (i, o = {}) => P.makePlace(M, keyOf, { id: i, ...o }) };
};
const walk = Mv.profileOf(), fly = Mv.profileOf({ way: "flight", speed: 2, stress: true });

/* ---- routes and reach with no edges are the routes there always were */
let W = world([[200, 50, "wall"]]);
let pl = Mv.plan(W.C, keyOf, W.at(0), W.at(3), walk);
const old = P.path(W.C, keyOf, W.at(0), W.at(3), "walk");
check(pl.zones.join("") === "abfgcd" && J(pl.steps) === J(old.steps) && pl.total === old.total && pl.cost.actions === 5 && pl.from.spot === "a" && pl.end.spot === "d", `walking round a wall: ${pl.zones.join("")}, the same steps as path()`);
check(Mv.plan(W.C, keyOf, W.at(0), W.at(3), fly).total === 5 && Mv.plan(W.C, keyOf, W.at(0), W.at(3), Mv.profileOf("burrow")).total === 3, "an inner wall stops flight too; burrowing ignores it (1995)");
let rc = Mv.reach(W.C, 0, walk);
check(rc[0].id === 0 && rc[0].d === 0 && rc[0].cost.within === "free" && rc.find((r) => r.id === 2).d === 4 && Mv.reach(W.C, 0, walk, 1).map((r) => r.id).join() === "0,1", "reach: every zone with its steps and cost, nearest first, capped on request");
check(Mv.reach(W.C, 0, fly).find((r) => r.id === 2).cost.within === "stress" && Mv.reach(W.C, 0, fly).find((r) => r.id === 1).cost.within === "plain", "reach with a power: what one action covers, what needs stress");
check(Mv.stepsFrom(W.C, 0, walk) === Mv.stepsFrom(W.C, 0, Mv.profileOf()), "the steps of a start are worked out once per zones state");

/* ---- levels at the ends, as in routeLength */
W = world([], [[250, 50, { building: true, floors: 2 }]]);
pl = Mv.plan(W.C, keyOf, W.at(0), W.at(2, { floor: 2 }), walk);
check(pl.total === 4 && pl.borders === 2 && pl.levels === 2 && pl.steps.map((s) => s.kind).join() === "border,border,level,level", "walking up the floors at the end");
check(Mv.plan(W.C, keyOf, W.at(0), W.at(1, { alt: "elevated" }), walk) === null && Mv.plan(W.C, keyOf, W.at(0), W.at(1, { alt: "elevated" }), fly).total === 1, "nobody walks into the air; a flyer ends there");
check(Mv.plan(W.C, keyOf, W.at(0), W.at(1, { alt: "elevated" }), Mv.profileOf("leap")) === null && Mv.plan(W.C, keyOf, W.at(0), W.at(2, { alt: "elevated" }), Mv.profileOf("leap")).end.roof === true, "a leap cannot end in the air, it can on a rooftop (2007)");
check(Mv.plan(W.C, keyOf, W.at(0), W.at(0, { alt: "sky" }), fly) === null && Mv.plan(W.C, keyOf, W.at(-1), W.at(0), walk) === null, "off the map or outside every zone: no plan (that is a level change the caller makes)");
check(Mv.plan(W.C, keyOf, W.at(0), W.at(1), Mv.profileOf("swing")) === null && Mv.plan(W.C, keyOf, W.at(0), W.at(2), Mv.profileOf("swing")).total === 2 && !Mv.reach(W.C, 0, Mv.profileOf("swing")).some((r) => r.id === 1), "swinging ends only where there is something to hang on (2028)");

/* ---- force: a route through what stops the mover, the blocked borders marked */
W = world([[200, 50, "wall"], [300, 50, "locked"]]);
pl = Mv.plan(W.C, keyOf, W.at(0), W.at(3), Mv.profileOf({ force: true }));
check(pl.zones.join("") === "abcd" && pl.steps.map((s) => !!s.border.blocked).join() === "false,true,true" && pl.steps[1].border.wall.armor === 2 && pl.steps[2].border.doorway.armor === 2, "a mover that may crash through: the straight route, the wall and the locked door marked with their Armor");
check(Mv.plan(W.C, keyOf, W.at(0), W.at(3), walk) === null, "... which a plain walker has no way through here");

/* ---- temporary edges */
// a tunnel under the wall b|c, a portal a <-> e
const edges = [{ id: "e1", kind: "tunnel", a: "b", b: "c", ways: ["walk", "through"] }, { id: "e2", kind: "portal", a: "a", b: "e:elevated" }];
W = world([[200, 50, "wall"], [200, 150, "wall"]], [], [], edges);
check(Mv.plan(W.C, keyOf, W.at(1), W.at(2), Mv.profileOf({ edges: false })) === null, "walled off without the edges");
pl = Mv.plan(W.C, keyOf, W.at(1), W.at(2), walk);
check(pl.total === 1 && pl.edges === 1 && pl.borders === 0 && pl.steps[0].kind === "edge" && pl.steps[0].edge.id === "e1" && pl.steps[0].from === "b" && pl.steps[0].to === "c" && pl.crossed.length === 0, "the tunnel under the wall: one step, no border crossed");
check(Mv.plan(W.C, keyOf, W.at(1), W.at(2), fly).zones.join("") === "baedc", "the tunnel lets through only the ways it names: a flyer goes round by the portal");
pl = Mv.plan(W.C, keyOf, W.at(1), W.at(3), walk);
check(pl.zones.join("") === "bcd" && pl.steps.map((s) => s.kind).join() === "edge,border" && pl.total === 2, "an edge and a border on one route");
pl = Mv.plan(W.C, keyOf, W.at(0), W.at(3), walk);
check(pl.zones.join("") === "aed" && pl.steps[0].kind === "edge" && pl.steps[0].edge.kind === "portal" && pl.total === 2, "the portal is the short way round");
check(Mv.plan(W.C, keyOf, W.at(0), W.at(3), Mv.profileOf({ edges: ["tunnel"] })).zones.join("") === "abcd", "a mover that takes tunnels but not portals");
check(Mv.reach(W.C, 0, walk).find((r) => r.id === 4).d === 1 && P.range(W.C, W.at(0), W.at(4)).total === 4 && P.routeLength(W.C, W.at(0), W.at(4), "walk") === null, "reach counts the portal; range and the plain route() never do");
check(Mv.edgeOpen({ kind: "portal" }, fly) && !Mv.edgeOpen({ kind: "portal", ways: ["walk"] }, fly) && Mv.edgeOpen({ kind: "portal", ways: ["flight"] }, fly) && !Mv.edgeOpen({ kind: "portal" }, Mv.profileOf({ edges: false })), "who may use an edge: its own list (by route or by name), the mover's switch");

/* ---- a chain somebody chose (a forced move, an edited chain) */
W = world([[200, 50, "wall"], [300, 50, "outer"]], [], [], edges);
pl = Mv.planAlong(W.C, keyOf, W.at(0), [0, 1, 2, 3], walk, W.at(3), { stairs: false });
check(pl.steps.map((s) => (s.kind === "edge" ? "edge" : !!s.border.blocked)).join() === "false,true,true" && pl.crossed.length === 3, "along a chosen chain: the borders in order, the blocked ones marked (the border is used where there is one, not the tunnel)");
pl = Mv.planAlong(W.C, keyOf, W.at(0, { alt: "elevated" }), [0, 1, 2, 3], Mv.profileOf("air"), W.at(3, { alt: "elevated" }), { stairs: false });
check(pl.steps.map((s) => !!s.border.blocked).join() === "false,true,false" && pl.steps[2].border.over === true && pl.steps.every((s) => s.level === "elevated"), "thrown at rooftop height: the inner wall is in the way, the exterior wall is passed over");
check(Mv.planAlong(W.C, keyOf, W.at(0), [0, 2], walk, W.at(2)) === null && Mv.planAlong(W.C, keyOf, W.at(0), [1, 2], walk, W.at(2)) === null && Mv.planAlong(W.C, keyOf, W.at(0), [0, 4, 3], walk, W.at(3)).steps[0].kind === "edge", "a chain must hang together and start where the mover is; an edge may join it");
check(Mv.chainRange(W.C, [0, 1, 2, 3]) === 3, "the range count of a chain");

/* ---- a chain along a direction */
W = world([[200, 50, "wall"]]);
let ry = Mv.rayChain(W.C, zoneAt, { x: 50, y: 50 }, { dx: 1, dy: 0 }, 3, 20, 2000);
check(J(ry.ids) === J([0, 1, 2, 3]) && ry.end === "distance" && Math.abs(ry.points[1].x - 110) <= 20 && ry.points.length === 4, "east for three zones: a, b, c, d and where each was entered");
ry = Mv.rayChain(W.C, zoneAt, { x: 350, y: 50 }, { dx: 5, dy: 0 }, 4, 20, 2000);
check(J(ry.ids) === J([3, 4]) && ry.end === "edge", "the line leaves the zones: the chain ends at the edge");
ry = Mv.rayChain(W.C, zoneAt, { x: 150, y: 50 }, { dx: 1, dy: 1 }, 2, 10, 2000);
check(J(ry.ids) === J([1, 5, 6]) || J(ry.ids) === J([1, 2, 6]), `a diagonal through a corner is joined by borders: ${ry.ids}`);
check(Mv.rayChain(W.C, zoneAt, { x: 50, y: 50 }, { dx: 0, dy: 0 }, 2, 20, 2000) === null && Mv.rayChain(W.C, zoneAt, { x: -50, y: 50 }, { dx: 1, dy: 0 }, 2, 20, 2000) === null && J(Mv.rayChain(W.C, zoneAt, { x: 50, y: 50 }, { dx: 1, dy: 0 }, 0, 20, 2000).ids) === J([0]), "no direction or no zone under the start: no chain; distance 0: the zone itself");
ry = Mv.rayChain(W.C, zoneAt, { x: 450, y: 50 }, { dx: -1, dy: 0 }, 9, 20, 2000);
check(J(ry.ids) === J([4, 3, 2, 1, 0]) && ry.end === "edge", "west across the whole map");

/* ---- a free spot in a zone */
const zb = Z.zones[1];                                             // 100..200 x 0..100: one grid square of 100, four of 50
let sp = Mv.freeSpot(zb, { w: 50, h: 50, grid: 50, near: { x: 100, y: 50 } });
check(sp.x === 100 && (sp.y === 0 || sp.y === 50) && !sp.crowded, `a free spot nearest to where it came in: ${sp.x},${sp.y}`);
sp = Mv.freeSpot(zb, { w: 50, h: 50, grid: 50, near: { x: 100, y: 50 }, taken: [{ x: 100, y: 0, w: 50, h: 50 }, { x: 100, y: 50, w: 50, h: 50 }] });
check(sp.x === 150 && !sp.crowded, "taken squares are passed over");
sp = Mv.freeSpot(zb, { w: 50, h: 50, grid: 50, taken: [0, 50].flatMap((y) => [100, 150].map((x) => ({ x, y, w: 50, h: 50 }))) });
check(sp.crowded === true && sp.x >= 100 && sp.x <= 150, "a full zone: a spot all the same, marked crowded");
sp = Mv.freeSpot(zb, { w: 100, h: 100, grid: 100 });
check(sp.x === 100 && sp.y === 0 && !sp.crowded, "a token as big as the zone fits it exactly");
sp = Mv.freeSpot(zb, { w: 200, h: 200, grid: 100 });
check(Number.isFinite(sp.x) && Number.isFinite(sp.y), "a token bigger than the zone still gets a spot");
const spots = [];
for ( let i = 0; i < 4; i++ ) { const s = Mv.freeSpot(zb, { w: 50, h: 50, grid: 50, taken: spots.map((q) => ({ ...q, w: 50, h: 50 })), near: { x: 150, y: 50 } }); spots.push({ x: s.x, y: s.y }); }
check(new Set(spots.map((s) => `${s.x},${s.y}`)).size === 4 && spots.every((s) => zoneAt(s.x + 25, s.y + 25) === 1), "four tokens into one zone: four different squares inside it");

/* ---- the step loop */
const steps = [{ n: 0 }, { n: 1, wall: true }, { n: 2 }];
const log = [];
const run = (listeners, blocked = (s) => !!s.wall && !breached) => Mv.runSteps({ steps, listeners, context: (step, index) => ({ step, index }), blocked, perform: async (s) => { log.push(`go${s.n}`); }, after: (s) => log.push(`after${s.n}`) });
let breached = false;
let res = await run([]);
check(res.done === 1 && res.stopped.index === 1 && res.stopped.reason === "blocked" && log.join() === "go0,after0", "nobody listening: the move stops at the blocked border");
log.length = 0;
// a listener that takes its time, breaches the wall on step 1 and lets the move go on
res = await run([async (ctx) => { await new Promise((r) => setTimeout(r, 5)); log.push(`ask${ctx.index}`); if ( ctx.step.wall ) breached = true; }]);
check(res.done === 3 && res.stopped === null && log.join() === "ask0,go0,after0,ask1,go1,after1,ask2,go2,after2", "a listener answers later; the border is looked at again after it (it was breached): the move goes on");
breached = false; log.length = 0;
res = await run([(ctx) => (ctx.index === 1 ? { stop: true, reason: "fire", data: { roll: 3 } } : undefined), () => { log.push("second"); }]);
check(res.done === 1 && res.stopped.reason === "fire" && res.stopped.data.roll === 3 && res.stopped.step.n === 1 && log.filter((l) => l === "second").length === 1, "a listener stops the move before a step: the step is not taken, later listeners are not asked");
log.length = 0;
res = await run([(ctx) => (ctx.step.wall ? { pass: true } : true)]);
check(res.done === 3 && res.stopped === null, "a listener lets the mover pass a blocked border");
res = await run([() => false]);
check(res.done === 0 && res.stopped.index === 0 && res.stopped.reason === null, "false stops it too");
res = await run([() => { throw new Error("boom"); }]);
check(res.done === 0 && res.stopped.reason === "error" && res.stopped.data.error === "boom", "a listener that throws stops the move");
log.length = 0;
const ls = [];
ls.push(() => { ls.length = 0; });                                   // a listener that unsubscribes everyone while being asked
res = await Mv.runSteps({ steps: [{ n: 0 }], listeners: ls, context: () => ({}), perform: async () => { log.push("go"); } });
check(res.done === 1 && log.join() === "go", "listeners may come and go during a move");

/* ---- a chain straight up or down: the rungs of one zone */
{
  // zone c (2) a building with two floors, zone d (3) a plain building, zone e (4) a wrecked building with floors, zone a (0) open ground
  const V = world([], [[250, 50, { building: true, floors: 2 }], [350, 50, { building: true }], [450, 50, { building: true, floors: 3, wrecked: true }]]);
  const rung = (i, o) => Mv.rungOf(V.M, V.at(i, o));
  check(rung(0) === 0 && rung(0, { alt: "underground" }) === -1 && rung(0, { alt: "elevated" }) === 1 && rung(2, { floor: 2 }) === 2 && rung(2, { alt: "elevated" }) === 3 && rung(4, { alt: "elevated" }) === 1 && Mv.rungOf(V.M, V.at(-1)) === null && Mv.topRung(V.M, 2) === 3,
    "rungs: underground -1, the ground 0, floors, the elevated position one above the top floor (one above the ground without floors)");
  check(Mv.slabOf(V.M, 2, 0) === "floor" && Mv.slabOf(V.M, 2, 1) === "floor" && Mv.slabOf(V.M, 2, 2) === "roof" && Mv.slabOf(V.M, 3, 0) === "roof" && Mv.slabOf(V.M, 0, 0) === null && Mv.slabOf(V.M, 4, 0) === null && Mv.slabOf(V.M, 0, -1) === "ground",
    "what lies between two rungs: a storey's floor, the roof, the ground over the underground; open air and a wrecked building: nothing");
  let rc = Mv.riseChain(V.M, keyOf, V.at(2), 1, 5);
  check(rc.end === "top" && rc.rung === 3 && J(rc.steps.map((s) => [s.from, s.to, s.level, s.floor, s.dir, s.slab])) === J([["c", "c:f1", "floor", 1, 1, "floor"], ["c:f1", "c:f2", "floor", 2, 1, "floor"], ["c:f2", "c:elevated", "elevated", 0, 1, "roof"]]) && rc.steps.every((s) => s.kind === "level" && s.zone === "c"),
    "up through a building with two floors: floor, floor, roof - then nothing above (sky high is off the map)");
  rc = Mv.riseChain(V.M, keyOf, V.at(2, { floor: 1 }), 1, 1);
  check(rc.end === "distance" && rc.rung === 2 && rc.steps.length === 1 && rc.steps[0].to === "c:f2", "one zone up from the first floor: the second");
  rc = Mv.riseChain(V.M, keyOf, V.at(2, { alt: "elevated" }), -1, 9);
  check(rc.end === "ground" && rc.rung === 0 && J(rc.steps.map((s) => [s.to, s.slab, s.dir])) === J([["c:f2", "roof", -1], ["c:f1", "floor", -1], ["c", "floor", -1]]), "down from the rooftop: through the roof and the floors to the ground, and no farther");
  rc = Mv.riseChain(V.M, keyOf, V.at(0), 1, 3);
  check(rc.end === "top" && rc.steps.length === 1 && rc.steps[0].to === "a:elevated" && rc.steps[0].slab === null, "up from open ground: one zone, into the air");
  rc = Mv.riseChain(V.M, keyOf, V.at(0, { alt: "underground" }), 1, 2);
  check(rc.end === "distance" && J(rc.steps.map((s) => [s.to, s.slab])) === J([["a", "ground"], ["a:elevated", null]]), "up from underground: out through the ground, then into the air");
  check(Mv.riseChain(V.M, keyOf, V.at(0), -1, 2).steps.length === 0 && Mv.riseChain(V.M, keyOf, V.at(0), -1, 2).end === "ground" && Mv.riseChain(V.M, keyOf, V.at(0, { alt: "underground" }), -1, 1).steps.length === 0, "down from the ground or from underground: nowhere (nobody is thrown underground)");
  check(Mv.riseChain(V.M, keyOf, V.at(2), 1, 0).steps.length === 0 && Mv.riseChain(V.M, keyOf, V.at(2), 1, 0).end === "distance" && Mv.riseChain(V.M, keyOf, V.at(-1), 1, 1) === null && Mv.riseChain(V.M, keyOf, V.at(2), 0, 1) === null, "no distance: no step; no zone or no direction: null");
  const pl2 = Mv.planOfLevels(keyOf, V.at(2), V.at(2, { alt: "elevated", air: true }), walk, Mv.levelSteps(V.M, keyOf, V.at(2), 3));
  check(pl2.total === 3 && pl2.levels === 3 && pl2.borders === 0 && pl2.zones.join() === "c" && pl2.cost.actions === 3 && pl2.from.spot === "c" && pl2.end.airborne === true && pl2.crossed.length === 0, "the chain as a plan: the shape plan() gives");
}

console.log(failed ? `${failed} failed` : "all zones moves checks passed");
process.exit(failed ? 1 : 0);
