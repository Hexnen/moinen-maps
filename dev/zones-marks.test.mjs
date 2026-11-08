// Zones: walls, doors, zone marks, distances per way of moving, fire spreading, the Invincible band.   node dev/zones-marks.test.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
globalThis.game = { i18n: { lang: "en", localize: (k) => k, format: (k, d) => `${k}:${JSON.stringify(d)}`, has: () => false } };
const G = await imp("scripts/zones/geometry.mjs");
const K = await imp("scripts/zones/marks.mjs");
const P = await imp("scripts/zones/presets.mjs");

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if ( !ok ) failed++; };

// a row of four zones: 0 | 1 | 2 | 3   (frame 0..400 x 0..100, dividers at 100, 200, 300)
const Z = G.buildZones([[-20, 0, 420, 0], [-20, 100, 420, 100], [0, -20, 0, 120], [400, -20, 400, 120], [100, -20, 100, 120], [200, -20, 200, 120], [300, -20, 300, 120]], { snap: 5, minArea: 100 });
const at = (x) => G.zoneAt(Z, x, 50);
check(Z.zones.length === 4 && [50, 150, 250, 350].map(at).join() === "0,1,2,3", `four zones in a row (${Z.zones.length})`);
const zoneAt = (x, y) => G.zoneAt(Z, x, y);
const M = (walls, marks = []) => K.resolve(Z, walls, marks, zoneAt, 35);

// border marks find their border; a far one is dropped
let m = M([[100, 40, "wall"], [250, 50, "wall"]]);
check(m.borders.size === 1 && m.borders.get(K.pairKey(0, 1))?.kind === "wall", "a mark on a border sticks to it; one inside a zone is dropped");
check(K.nearestBorder(Z, 0, 50, 10) === null, "the map's outer edge is no border between zones");

// walking vs flying vs burrowing past walls
let D = K.moveDistances(Z, 0, M([[100, 50, "wall"]]));
check(D.walk.get(3) === undefined && D.air.get(3) === undefined && D.through.get(3) === 3, "an inner wall stops walking and flying, not burrowing");
D = K.moveDistances(Z, 0, M([[100, 50, "outer"]]));
check(D.walk.get(1) === undefined && D.air.get(1) === 1, "an exterior wall: flight goes over it, walking does not");
D = K.moveDistances(Z, 0, M([[100, 50, "door"]]));
check(D.walk.get(1) === 1, "an open door lets walkers through");
D = K.moveDistances(Z, 0, M([[100, 50, "locked"]]));
check(D.walk.get(1) === undefined && D.air.get(1) === undefined && D.through.get(1) === 1, "a locked door stops all but burrowing / teleportation");

// swimming only through water; swinging only ends on buildings or tall features
D = K.moveDistances(Z, 0, M([], [[150, 50, { water: true }], [250, 50, { flooded: true }]]));
check(D.swim.get(2) === 2 && D.swim.get(3) === undefined, "swimming moves through water and flooded zones only");
D = K.moveDistances(Z, 0, M([], [[250, 50, { building: true }], [350, 50, { building: true, wrecked: true }]]));
check(D.swing.get(2) === 2 && D.swing.get(1) === undefined && D.swing.get(3) === undefined, "swinging ends on a standing building, not open ground or a wrecked one");

// marks of a zone merge; props are cleaned
m = M([], [[150, 50, { fire: 30, junk: 1 }], [160, 40, { dark: true }]]);
check(m.zones.get(1)?.dark === true && m.zones.get(1)?.fire === 12 && Object.keys(m.zones.get(1)).length === 2, "zone marks merge, fire capped at 12, unknown props dropped");
check(JSON.stringify(K.withoutStates({ building: true, fire: 6, ice: true })) === JSON.stringify({ building: true }), "clearing states keeps the features");

// fire: 1-2 goes out, 5-6 spreads through open borders only
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
let r = K.fireRound(Z, M([], [[150, 50, { fire: 7 }]]), seq(0.0));
check(r.log[0].out && !r.next.get(1).fire, "D6 = 1: the fire goes out");
r = K.fireRound(Z, M([], [[150, 50, { fire: 7 }]]), seq(0.9, 0.0));
check(r.log[0].roll === 6 && r.log[0].to === 0 && r.next.get(0).fire === 7, "D6 = 6: the fire spreads to a neighbour with the same Intensity");
r = K.fireRound(Z, M([[100, 50, "wall"], [200, 50, "door"]], [[150, 50, { fire: 7 }]]), seq(0.9, 0.0));
check(r.log[0].to === undefined && r.next.get(1).fire === 7, "walls and doors stop the fire spreading");
r = K.fireRound(Z, M([], [[150, 50, { fire: 7 }], [50, 50, { water: true }]]), seq(0.9, 0.0));
check(r.log[0].to === 2, "fire does not spread into water");

// the Invincible band picks the cheapest way and reports the zones it counted
const inv = P.preset("invincible");
const fly = [{ key: "flight", name: "Flight", level: 0, range: 2, stress: 4 }];
const dig = [{ key: "burrowing", name: "Burrowing", level: 0, range: 2, stress: 4 }];
let b = inv.band({ walk: undefined, air: undefined, through: 3, swim: undefined, swing: undefined }, fly);
check(b.key === "blocked" && b.d === null, "no way at all: blocked");
b = inv.band({ walk: undefined, air: 2, through: 2, swim: undefined, swing: undefined }, fly);
check(b.key === "power" && b.d === 2, "walls in the way on foot, flight over: power, 2 zones");
b = inv.band({ walk: 5, air: undefined, through: 3, swim: undefined, swing: undefined }, dig);
check(b.key === "powerStress" && b.d === 3, "burrowing under the walls counts its own (shorter) route");
b = inv.band(1, fly);
check(b.key === "walk1" && b.d === 1, "a plain number still works (the old call)");
b = inv.band({ walk: 7, air: 7, through: 7, swim: undefined, swing: undefined }, []);
check(b.key === "far" && b.d === 7, "far: shows the walking distance");


// states from the map's layers (link.mjs)
const Lk = await imp("scripts/zones/link.mjs");
const LS = Lk.samplesOf(Z, zoneAt, 25);
check([...LS.values()].every((p) => p.length >= 8), "every zone gets sample points");
const rect = { x: 0, y: 0 };
let D2 = Lk.derive(LS, { fire: [{ id: "a", k: "fire", p: [150, 50], r: 40, lv: 3 }, { id: "b", k: "fire", p: [350, 50], r: 40, lv: 1, o: 5 }] });
check(D2.get(1)?.fire === 10 && !D2.get(3), "a burning blaze makes its zone burn at Intensity 10; a fire put out does not count");
const W = 400, H = 100, wm = new Uint8Array(W * H); for ( let y = 0; y < H; y++ ) for ( let x = 200; x < 300; x++ ) wm[y * W + x] = 1;
D2 = Lk.derive(LS, { water: { px: 1, w: W, h: H, masks: { water: wm }, rect } });
check(D2.get(2)?.water && !D2.get(1), "water painted over a zone gives it water");
const dm = new Uint8Array(W * H); for ( let y = 0; y < H; y++ ) for ( let x = 0; x < 60; x++ ) dm[y * W + x] = 2; for ( let y = 0; y < H; y++ ) for ( let x = 300; x < 400; x++ ) dm[y * W + x] = 1 | (3 << 2);
D2 = Lk.derive(LS, { dest: { mask: dm, mw: W, mh: H, mpx: 1, rect } });
check(D2.get(0)?.wrecked && !D2.get(0)?.flooded && D2.get(3)?.flooded && !D2.get(3)?.wrecked, "broken ground wrecks a zone, flood damage floods it");
const sm = new Uint8Array(W * H); for ( let y = 0; y < 10; y++ ) for ( let x = 100; x < 200; x++ ) sm[y * W + x] = 2;
check(!Lk.derive(LS, { dest: { mask: sm, mw: W, mh: H, mpx: 1, rect } }).get(1), "a little damage at a zone's edge does not wreck it");
check(JSON.stringify(Lk.merge({ fire: 6, dark: true }, { fire: 8, water: true })) === JSON.stringify({ fire: 8, dark: true, water: true }), "own marks and the map's states merge (fire: the higher)");


// floors: a building's floors are vertical zones; walkers come down first
const MF = M([], [[350, 50, { building: true, floors: 3 }], [150, 50, { building: true, floors: 2, wrecked: true }]]);
check(K.floorsOf(MF, 3) === 3 && K.floorsOf(MF, 1) === 0 && K.floorsOf(MF, 0) === 0, "floors only count in a standing building");
check(K.vertical(MF, 3, 2, "ground") === 2 && K.vertical(MF, 3, 9, "ground") === 3 && K.vertical(MF, 3, 0, "elevated") === 4 && K.vertical(MF, 0, 2, "ground") === 0, "a token's height: its floor, the rooftop one above the top floor");
const dv = K.addVertical({ walk: 1, air: 1, through: 1, swim: undefined, swing: 1 }, 3);
check(dv.walk === 4 && dv.air === 1 && dv.through === 1 && dv.swim === undefined, "walking adds the way down; flight leaves by a window");
check(K.cleanProps({ building: true, floors: 99 }).floors === 40 && K.cleanProps({ floors: 0 }).floors === undefined, "floors are capped and dropped at 0");

console.log(failed ? `${failed} check(s) failed` : "all zones marks checks passed");
process.exit(failed ? 1 : 0);
