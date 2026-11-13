// Zones: the border model (a wall with an optional door, each with its own Armor and state), the zone-state registry and the
// temporary edges - the pure parts and the flag they are stored in.   node dev/zones-borders.test.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
const G = await imp("scripts/zones/geometry.mjs");
const K = await imp("scripts/zones/marks.mjs");
const P = await imp("scripts/zones/places.mjs");
const B = await imp("scripts/zones/borders.mjs");
const S = await imp("scripts/zones/states.mjs");
globalThis.Hooks = { on() {}, once() {}, callAll() {} };          // model.mjs reads the module id from config.mjs, which listens to a hook
const Model = await imp("scripts/zones/model.mjs");

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if ( !ok ) failed++; };
const J = JSON.stringify;

/* ---- the older kinds read as walls and doors, with the Armor and the stops they always had */
const OLD_ARMOR = { door: 1, locked: 2, wall: 2, outer: 3, reinforced: 4 };
const OLD_STOPS = { door: [false, false], locked: [true, true], wall: [true, true], outer: [true, false], reinforced: [true, true] };
for ( const k of Object.keys(OLD_ARMOR) ) {
  const m = B.model(k);
  check(m.kind === k && m.base === k && m.armor === OLD_ARMOR[k] && J([m.stops.walk, m.stops.air]) === J(OLD_STOPS[k]) && m.stops.through === false && m.wall.state === "intact" && B.playOf(m) === null,
    `an old "${k}" mark: kind ${m.kind}, Armor ${m.armor}, stops walk/air ${m.stops.walk}/${m.stops.air}, wall ${m.wall.armor}${m.door ? `, door ${m.door.armor} ${m.door.state}` : ""}`);
}
check(B.model("door").door.state === "closed" && B.model("locked").door.state === "locked" && B.model("wall").door === null && B.model("outer").wall.outer === true && B.model("open") === null, "door closed (unlocked), locked door locked, a wall has no door, an exterior wall is outer; open is no wall");
check(J(K.ARMOR) === J(OLD_ARMOR) && J(K.BORDER_KINDS) === J(["open", "door", "locked", "wall", "outer", "reinforced"]), "marks.mjs still offers the old kinds and their Armor");

/* ---- each has its own Armor and state */
let m = B.model("outer", { door: { state: "sealed" } });
check(m.wall.armor === 3 && m.door.armor === 2 && m.door.state === "sealed" && m.kind === "locked" && m.armor === 2 && m.stops.walk && !m.stops.air && m.look === "outer", "an exterior wall with a sealed door: the door's Armor is an exterior door's (2), flyers still pass over");
m = B.model("reinforced", { wall: { armor: 6 }, door: {} });
check(m.wall.armor === 6 && m.door.armor === 6 && m.door.state === "closed" && m.kind === "door" && !m.stops.walk, "a door in a reinforced wall is a reinforced door; closed and unlocked it lets one through");
m = B.model("wall", { door: { armor: 5, state: "locked" } });
check(m.wall.armor === 2 && m.door.armor === 5 && m.armor === 5 && m.kind === "locked", "the wall and the door keep their own Armor");
check(B.cleanExt("door", { door: { armor: 1, state: "closed" }, wall: { armor: 2, outer: false } }) === null && B.cleanExt("wall", { junk: 1 }) === null && J(B.cleanExt("door", { door: null })) === J({ door: null }) && B.model("door", { door: null }).kind === "wall",
  "only what differs from the kind is stored; a door mark with its door taken out is a wall");
check(B.cleanExt("wall", { door: { state: "breached" } }).door.state === undefined && B.cleanExt("wall", { wall: { armor: -3 } }) === null && B.cleanExt("wall", { wall: { armor: 1e9 } }).wall.armor === B.ARMOR_MAX, "a door is not built breached; Armor stays in bounds");

/* ---- what happens in play */
m = B.model("wall", null, { w: "breached" });
check(m.kind === "open" && m.armor === 0 && !m.stops.walk && !m.stops.air && m.wall.state === "breached" && m.wall.armor === 2 && m.base === "wall", "a breached wall: open now, the wall and its Armor still known");
m = B.model("locked", null, { d: "open" });
check(m.kind === "door" && !m.stops.walk && m.door.state === "open" && m.door.built === "locked" && m.wall.state === "intact", "a locked door opened: passable, built state remembered");
m = B.model("door", null, { d: "sealed" });
check(m.kind === "locked" && m.stops.walk && m.stops.air && m.armor === 1, "a door sealed electronically stops like a locked one");
m = B.model("door", null, { d: "breached" });
check(m.kind === "door" && !m.stops.walk && m.door.state === "breached", "a breached door lets one through, the wall around it stands");
m = B.model("outer", null, { w: "removed", t: 1 });
check(m.kind === "open" && m.wall.temp === true && J(B.playOf(m)) === J({ w: "removed", t: 1 }) && B.model("outer", null, { w: "breached", t: 1 }).wall.temp === false, "a wall removed for a while says so (only a removed one can)");
check(B.cleanPlay({ w: "intact" }) === null && B.cleanPlay({ d: "ajar" }) === null && B.cleanPlay(null) === null && J(B.cleanPlay({ w: "removed", d: "open", x: 1 })) === J({ w: "removed", d: "open" }), "play records are cleaned");

// patches: state changes, and the inverse is the play record before
m = B.model("locked");
let r = B.patchPlay(m, { door: { state: "open" } });
check(J(r.play) === J({ d: "open" }) && B.patchPlay(B.model("locked", null, r.play), { door: { state: "locked" } }).play === null, "opening a locked door and locking it again leaves no play record");
r = B.patchPlay(m, { wall: { state: "removed", temp: true }, door: { state: "breached" } });
check(J(r.play) === J({ w: "removed", t: 1, d: "breached" }), "the wall and the door change in one patch");
check(B.patchPlay(B.model("wall", null, { w: "removed", t: 1 }), { wall: { state: "intact" } }).play === null, "a wall put back: as built");
check(B.patchPlay(null, { wall: { state: "breached" } }).error === "noWall" && B.patchPlay(B.OPEN, {}).error === "noWall" && B.patchPlay(B.model("wall"), { door: { state: "open" } }).error === "noDoor"
  && B.patchPlay(m, { door: { state: "ajar" } }).error === "doorState" && B.patchPlay(m, { wall: { state: "gone" } }).error === "wallState", "what cannot be: no wall, no door, unknown states");
check(J(B.contractOf(B.model("locked", null, { w: "breached" }))) === J({ wall: { armor: 2, state: "breached" }, door: { armor: 2, state: "locked" } }) && J(B.contractOf(null)) === J({ wall: null, door: null }), "the shape the combat rules take");
check(J(B.drawOf(B.model("locked"))) === J({ wall: "wall", wallState: "intact", temp: false, door: "locked" }) && B.drawOf(B.model("door", null, { w: "breached" })).door === null && B.drawOf(null) === null && B.drawOf(B.OPEN) === null, "what is drawn: the wall's look and state, the door's sign while the wall stands");
check(B.sigOf(B.model("door")) !== B.sigOf(B.model("door", null, { d: "open" })) && B.sigOf(B.model("wall")) !== B.sigOf(B.model("wall", { wall: { armor: 3 } })) && B.sigOf(null) === "open", "a signature that moves with every change");

// the hole drawn in a breached wall
check(J(B.cutSegment([0, 0, 100, 0], 50, 0, 10)) === J([[0, 0, 40, 0], [60, 0, 100, 0]]) && J(B.cutSegment([0, 0, 100, 0], 0, 0, 10)) === J([[10, 0, 100, 0]]) && B.cutSegment([45, 0, 55, 0], 50, 0, 10).length === 0
  && B.cutSegment([0, 0, 100, 0], 50, 30, 10).length === 1 && B.cutSegment([0, 0, 100, 0], 200, 0, 10).length === 1 && B.cutSegment([5, 5, 5, 5], 5, 5, 1).length === 0, "a segment with a hole cut out of it: two pieces, one, none, or untouched");
check(J(B.normPlay(B.model("locked"), { d: "locked", w: "breached" })) === J({ w: "breached" }) && B.normPlay(B.model("wall"), { d: "open" }) === null && B.normPlay(null, { w: "breached" }) === null, "a play record made to fit its border");
check(J(B.buildFrom(null, { kind: "outer", door: { state: "sealed" } })) === J(["outer", { door: { state: "sealed" } }]) && J(B.buildFrom(B.model("locked"), { wall: { armor: 5 } })) === J(["locked", { wall: { armor: 5 } }]) && J(B.buildFrom(B.model("door"), { door: null })) === J(["door", { door: null }])
  && B.buildFrom(B.model("door"), { wall: null }) === null && B.buildFrom(null, { kind: "open" }) === null && B.buildFrom(null, { kind: "moat" }) === undefined && B.buildFrom(null, { door: { state: "breached" } }) === undefined && J(B.buildFrom(null, {})) === J(["wall"]), "building a border anew: a kind and what differs from it; open; refused");

/* ---- on the zones: a row of four zones 0 | 1 | 2 | 3, keys a b c d */
const Z = G.buildZones([[-20, 0, 420, 0], [-20, 100, 420, 100], [0, -20, 0, 120], [400, -20, 400, 120], [100, -20, 100, 120], [200, -20, 200, 120], [300, -20, 300, 120]], { snap: 5, minArea: 100 });
const zoneAt = (x, y) => G.zoneAt(Z, x, y);
const keyOf = (id) => "abcd"[id] ?? null, idOf = (k) => "abcd".indexOf(k);
const world = (walls = [], marks = [], plays = [], X = null) => { const M = K.resolve(Z, walls, marks, zoneAt, 35, plays); return { M, C: P.makeCache(Z, M, X), at: (id, o = {}) => P.makePlace(M, keyOf, { id, ...o }) }; };

let W = world([[100, 50, "wall"], [200, 50, "locked"], [300, 50, "outer", { door: { state: "sealed" } }]]);
let bi = P.borderInfo(W.C, keyOf, 0, 1);
check(bi.kind === "wall" && bi.armor === 2 && bi.door === false && bi.base === "wall" && J(bi.wall) === J({ armor: 2, state: "intact", outer: false, temp: false }) && bi.doorway === null, "borderInfo: the old fields and the wall");
bi = P.borderInfo(W.C, keyOf, 2, 3);
check(bi.kind === "locked" && bi.door === true && bi.armor === 2 && bi.wall.armor === 3 && bi.wall.outer && bi.doorway.state === "sealed" && bi.stops.walk && !bi.stops.air, "borderInfo: a sealed door in an exterior wall");
check(P.routeLength(W.C, W.at(0), W.at(3), "walk") === null && P.routeLength(W.C, W.at(2), W.at(3), "air").total === 1 && P.range(W.C, W.at(0), W.at(3)).total === 3, "routes stop where the borders stop; range counts them all");
const open = P.borderInfo(W.C, keyOf, 0, 1); open.wall.state = "x";
check(P.borderInfo(W.C, keyOf, 0, 1).wall.state === "intact", "a caller cannot change the border it was given");
// play: the wall a|b breached, the locked door b|c opened, the sealed door c|d left
W = world([[100, 50, "wall"], [200, 50, "locked"], [300, 50, "outer", { door: { state: "sealed" } }]], [], [[100, 20, { w: "breached" }], [200, 80, { d: "open" }], [150, 50, { w: "removed" }]]);
check(P.borderInfo(W.C, keyOf, 0, 1).kind === "open" && P.borderInfo(W.C, keyOf, 0, 1).wall.state === "breached" && P.borderInfo(W.C, keyOf, 1, 2).kind === "door" && P.borderInfo(W.C, keyOf, 1, 2).doorway.state === "open", "play records find their border by a point on it; one far from every border is dropped");
check(P.routeLength(W.C, W.at(0), W.at(2), "walk").total === 2 && P.routeLength(W.C, W.at(0), W.at(3), "walk") === null && P.path(W.C, keyOf, W.at(0), W.at(2), "walk").crossed.map((b) => b.kind).join() === "open,door", "walking goes through the breach and the opened door, not through the sealed one");
/* ---- A14 (the user's answer of 2026-11-12): from outside a flyer passes over every building by its roof; walls inside a building stop it */
{
  const air = (Wd, x, y) => P.routeLength(Wd.C, Wd.at(x), Wd.at(y), "air");
  // a | b building | c building | d: an inner wall a|b, an inner wall b|c, a locked door c|d
  let A = world([[100, 50, "wall"], [200, 50, "wall"], [300, 50, "locked"]], [[150, 50, { building: true }], [250, 50, { building: true }]]);
  check(air(A, 0, 1)?.total === 1 && air(A, 3, 2)?.total === 1 && P.borderInfo(A.C, keyOf, 0, 1).stops.air === false && P.borderInfo(A.C, keyOf, 0, 1).stops.walk === true,
    "A14: open ground to a building over a wall marked interior - the flyer goes over its roof (borderInfo says so too), the walker does not");
  check(air(A, 1, 2) === null && P.borderInfo(A.C, keyOf, 1, 2).stops.air === true && air(A, 0, 3) === null,
    "A14: a wall between two zones of a building stops a flyer");
  A = world([[100, 50, "wall"], [200, 50, "outer"], [300, 50, "locked"]], [[150, 50, { building: true }], [250, 50, { building: true }]]);
  check(air(A, 1, 2)?.total === 1 && air(A, 0, 3)?.total === 3, "A14: two buildings side by side (their wall marked exterior): over both roofs, street to street");
  A = world([[100, 50, "wall"], [200, 50, "wall"]], [[150, 50, { building: true, wrecked: true }], [250, 50, { building: true }]]);
  check(air(A, 0, 1) === null && air(A, 1, 2)?.total === 1, "A14: a wrecked building has no roof to pass over (a wall between it and open ground stops a flyer); from it a standing building's roof is reached");
  A = world([[100, 50, "wall"], [200, 50, "outer"]]);
  check(air(A, 0, 1) === null && air(A, 1, 2)?.total === 1, "A14: a freestanding wall between open zones stops a flyer unless it is marked exterior (as before)");
  const md = K.moveDistances(Z, 0, world([[100, 50, "wall"]], [[150, 50, { building: true }]]).M);
  check(md.air.get(1) === 1 && md.walk.get(1) === undefined && md.swing.get(1) === 1, "A14: the distances the presets read agree (air and swing over the roof)");
}
// fire spreading: a standing wall blocks it, a breached one does not
let fr = K.fireRound(Z, world([[100, 50, "wall"]], [[50, 50, { fire: 7 }]]).M, () => 0.99);
check(fr.log[0].to === undefined, "fire does not spread through a standing wall");
fr = K.fireRound(Z, world([[100, 50, "wall"]], [[50, 50, { fire: 7 }]], [[100, 50, { w: "breached" }]]).M, () => 0.99);
check(fr.log[0].to === 1, "... and does through a breached one");

/* ---- the flag: old scenes as they were, the new parts only when there is something */
const flag = (f) => ({ flags: { "moinen-maps": { zones: f } } });
const oldFlag = { v: 1, s: [[1, [100, -20, 100, 120]]], next: 2, preset: null, lookFrom: null, snap: 0.25, smooth: 0.3, look: Model.cleanLook(), w: [[100, 50, "locked"]], m: [[50, 50, { fire: 6 }]] };
let St = Model.load(flag(oldFlag));
check(J(Model.encode(St)) === J(oldFlag), "an old scene decodes and encodes to exactly what it was (no new keys)");
check(J(St.walls) === J([[100, 50, "locked"]]) && St.plays.length === 0 && St.states.length === 0 && St.edges.length === 0 && St.playNext === 1, "... its walls as three values, no play state");
St = Model.load(flag({ ...oldFlag, w: [[100, 50, "outer", { door: { state: "sealed", armor: 2 }, junk: 1 }], [1, 1, "open"], [2, 2, "wall", { wall: { armor: 2 } }]],
  bs: [[100, 50, { d: "open" }], [5, 5, {}], ["x", 1, { w: "breached" }]],
  q: [[50, 50, { id: "s1", kind: "smoke", owner: { combatant: "c1" }, ends: "scene", except: ["c1", "c1", 7], level: 2, junk: 1 }], [60, 60, { id: "s1", kind: "dark" }], [70, 70, { kind: "dark" }], [80, 80, { id: "s2", kind: "Bad Kind" }]],
  e: [{ id: "e3", kind: "portal", a: "z1", b: "z4:f2", ways: ["walk", "bad way"], owner: "c2" }, { id: "e3", kind: "tunnel", a: "z1", b: "z2" }, { id: "e4", kind: "portal", a: "z1", b: "z1" }, { kind: "portal", a: "z1", b: "z2" }],
  pn: 5 }));
check(J(St.walls) === J([[100, 50, "outer", { door: { state: "sealed" } }], [2, 2, "wall"]]), "walls: the extension cleaned to what differs from the kind");
check(J(St.plays) === J([[100, 50, { d: "open" }]]), "play records: only well-formed ones");
check(J(St.states) === J([[50, 50, { id: "s1", kind: "smoke", level: 2, owner: { combatant: "c1" }, ends: "scene", except: ["c1"] }]]), "states: cleaned, one per id, an id needed");
check(J(St.edges) === J([{ id: "e3", kind: "portal", a: "z1", b: "z4:f2", owner: "c2", ways: ["walk"] }]) && St.playNext === 5, "edges: cleaned, one per id, two different ends; the counter");
const enc = Model.encode(St);
check(J(Model.encode(Model.load(flag(JSON.parse(J(enc)))))) === J(enc) && enc.pn === 5 && enc.bs.length === 1 && enc.q.length === 1 && enc.e.length === 1 && enc.w[0].length === 4 && enc.w[1].length === 3, "the new parts survive a save and a load");

/* ---- the registry */
check(S.cleanState({ kind: "fire", level: "8", at: "f2", data: { a: 1 } }).level === 8 && S.cleanState({ kind: "fire", at: "roof" }) === null && S.cleanState({ kind: "x", owner: "o".repeat(S.OPAQUE_MAX + 1) }) === null && S.cleanState({ kind: "x", id: "bad id" }) === null && S.cleanState({}) === null,
  "a state: numbers as numbers, a level name checked, nothing too big, a well-formed id");
const big = { kind: "x" }; big.data = big;
check(S.cleanState(big) === null, "a value that cannot be stored is refused");
check(J(S.propsOf([{ kind: "wrecked" }, { kind: "fire", level: 7 }, { kind: "fire", level: 30 }, { kind: "fire" }, { kind: "dark" }, { kind: "smoke" }, { kind: "gravity", data: { mode: "low" } }, { kind: "gravity", data: { mode: "high" } }, { kind: "flooded" }, { kind: "ice" }, { kind: "toxic" }]))
  === J({ wrecked: true, fire: 12, dark: true, lowgrav: true, flooded: true, ice: true }), "the states the map draws read as its zone properties (fire by its level, capped); smoke, toxic, high gravity are stored only");
check(J(S.mergeProps({ fire: 9, building: true }, { fire: 4, dark: true })) === J({ fire: 9, building: true, dark: true }), "a fire shows its higher Intensity");
const by = S.resolveStates([[50, 50, { id: "s1", kind: "dark" }], [150, 50, { id: "s2", kind: "smoke", at: "elevated" }], [150, 60, { id: "s3", kind: "fire", level: 6 }], [999, 999, { id: "s4", kind: "dark" }]], zoneAt);
check(by.get(0).length === 1 && by.get(1).map((s) => s.id).join() === "s2,s3" && by.size === 2, "states keep to the zone their point lies in");
let ls = S.listStates(by.get(1), { fire: 8, lowgrav: true, building: true }, { wrecked: true });
check(ls.map((s) => `${s.source}:${s.id}`).join() === "registry:s2,registry:s3,mark:mark:fire,mark:mark:lowgrav,map:map:wrecked" && ls[2].level === 8 && ls[3].kind === "gravity" && ls[3].data.mode === "low", "every state of a zone as records: the registry's, the GM's marks, the map's layers");
check(S.listStates(by.get(1), {}, {}, "ground").map((s) => s.id).join() === "s3" && S.listStates(by.get(1), {}, {}, "elevated").map((s) => s.id).join() === "s2,s3", "by level: a state with no level named holds on every level");
check(S.atOfSpot("z3:f2") === "f2" && S.atOfSpot("z3") === "ground" && S.atOfSpot("z3:elevated") === "elevated" && S.atOfSpot("@sky") === null, "the level of a spot");
// through the cache: zone data carries the records
W = world([], [[150, 50, { fire: 8 }]], [], { states: by, own: new Map([[1, { fire: 8 }]]), map: new Map() });
check(P.zoneInfo(W.C, keyOf, 1).records.map((s) => s.id).join() === "s2,s3,mark:fire" && P.zoneInfo(W.C, keyOf, 2).records.length === 0, "zone data: records");

/* ---- temporary edges */
const E = S.resolveEdges([{ id: "e1", kind: "portal", a: "a", b: "d:elevated" }, { id: "e2", kind: "tunnel", a: "a", b: "zz" }, { id: "e3", kind: "portal", a: "b", b: "@dimension" }, { id: "e4", kind: "portal", a: "c", b: "c:elevated" }], idOf);
check(E.live.map((e) => e.id).join() === "e1,e4" && E.links.get(0)[0].to === 3 && E.links.get(3)[0].to === 0 && !E.links.has(2), "edges join the zones that exist; one to an area off the map or to a zone that is gone joins nothing");
check(S.cleanEdge({ kind: "portal", a: "a", b: "b:nope" }) === null && S.cleanEdge({ kind: "portal", a: "a" }) === null && S.cleanEdge({ kind: "tunnel", a: "a", b: "b", data: { size: "human" } }).data.size === "human", "an edge needs two spots");

console.log(failed ? `${failed} failed` : "all zones borders checks passed");
process.exit(failed ? 1 : 0);
