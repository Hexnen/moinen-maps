// Zones: stable keys - anchors, provisional keys, pinning, cuts and joins, the scene flag.   node dev/zones-keys.test.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
globalThis.Hooks = { on() {}, once() {}, callAll() {} };      // (scripts/config.mjs registers a hook when it loads)
const G = await imp("scripts/zones/geometry.mjs");
const K = await imp("scripts/zones/keys.mjs");
const Model = await imp("scripts/zones/model.mjs");
const { MODULE_ID } = await imp("scripts/config.mjs");

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if ( !ok ) failed++; };

// a row of zones in the frame 0..400 x 0..100, cut at the given x
const frame = [[-20, 0, 420, 0], [-20, 100, 420, 100], [0, -20, 0, 120], [400, -20, 400, 120]];
const row = (...cuts) => G.buildZones([...frame, ...cuts.map((x) => [x, -20, x, 120])], { snap: 5, minArea: 100 });
const at = (Z) => (x, y) => G.zoneAt(Z, x, y);
const keysAt = (Z, R, xs) => xs.map((x) => R.keyOf.get(G.zoneAt(Z, x, 50))).join();

// 1. a scene from before keys: no anchors, counter 1 -> z1.. in id order, the same on every client, nothing to write
let Z = row(100, 200, 300);
let R = K.resolve(Z, [], 1, at(Z));
check(keysAt(Z, R, [50, 150, 250, 350]) === "z1,z2,z3,z4" && R.pinned.size === 0 && R.next === 5, "no anchors: the keys are z1..z4 in id order (provisional)");
check([...R.idOf].every(([k, id]) => R.keyOf.get(id) === k) && R.idOf.size === 4, "idOf is the inverse of keyOf");
check(JSON.stringify([...K.resolve(Z, [], 1, at(Z)).keyOf]) === JSON.stringify([...R.keyOf]), "the same input gives the same keys (every client agrees)");

// 2. pinning writes the provisional keys down, unchanged; a second pin changes nothing
let P = K.pin(Z, [], 1, at(Z));
check(P.changed && P.anchors.length === 4 && P.next === 5, `pin: four anchors, counter 5 (${P.anchors.length}, ${P.next})`);
R = K.resolve(Z, P.anchors, P.next, at(Z));
check(keysAt(Z, R, [50, 150, 250, 350]) === "z1,z2,z3,z4" && R.pinned.size === 4, "pinned keys are the provisional ones");
check(!K.pin(Z, P.anchors, P.next, at(Z)).changed, "pin again: nothing changes");
check(P.anchors.every(([, x, y]) => G.zoneAt(Z, x, y) >= 0 && x === Math.round(x * 10) / 10 && y === Math.round(y * 10) / 10), "anchors lie inside their zones, rounded as the flag stores them");

// 3. a zone cut in two: every zone is renumbered, the keys stay; the half with the anchor keeps the key, the other is new
let Z2 = row(100, 130, 200, 300);
R = K.resolve(Z2, P.anchors, P.next, at(Z2));
check(Z2.zones.length === 5 && keysAt(Z2, R, [50, 115, 165, 250, 350]) === "z1,z5,z2,z3,z4", `cut: ${keysAt(Z2, R, [50, 115, 165, 250, 350])} (ids ${[50, 115, 165, 250, 350].map((x) => G.zoneAt(Z2, x, 50)).join()})`);
let P2 = K.pin(Z2, P.anchors, P.next, at(Z2));
check(P2.anchors.length === 5 && P2.next === 6 && keysAt(Z2, K.resolve(Z2, P2.anchors, P2.next, at(Z2)), [50, 115, 165, 250, 350]) === "z1,z5,z2,z3,z4", "cut, pinned: the new half keeps the key it was shown with");

// 4. two zones joined: the older anchor names the zone, the other sleeps and wakes when the line returns
let Z3 = row(100, 130, 300);
R = K.resolve(Z3, P2.anchors, P2.next, at(Z3));
check(keysAt(Z3, R, [50, 115, 220, 350]) === "z1,z5,z2,z4" && !R.idOf.has("z3"), `join: ${keysAt(Z3, R, [50, 115, 220, 350])}, z3 names nothing`);
let P3 = K.pin(Z3, P2.anchors, P2.next, at(Z3));
check(P3.anchors.some(([k]) => k === "z3") && P3.next === 6, "join, pinned: the sleeping anchor is kept, no key is spent");
R = K.resolve(Z2, P3.anchors, P3.next, at(Z2));
check(keysAt(Z2, R, [50, 115, 165, 250, 350]) === "z1,z5,z2,z3,z4", "the line returns: z3 names its zone again");

// 5. a key is never handed out twice: a new zone after the join gets a new number, not the sleeping one
let Z4 = row(100, 130, 300, 350);
R = K.resolve(Z4, P3.anchors, P3.next, at(Z4));
check(keysAt(Z4, R, [50, 115, 220, 325, 375]).split(",").sort().join() === "z1,z2,z4,z5,z6", `new zone: ${keysAt(Z4, R, [50, 115, 220, 325, 375])}`);
// provisional keys skip keys that anchors already use, whatever the counter says
R = K.resolve(Z, [["z2", 50, 50]], 1, at(Z));
check(keysAt(Z, R, [50, 150, 250, 350]) === "z2,z1,z3,z4", `a used key is skipped: ${keysAt(Z, R, [50, 150, 250, 350])}`);

// 6. the lines all gone and back: anchors outside every zone name nothing, and name their zones again later
R = K.resolve(null, P.anchors, P.next, () => -1);
check(R.keyOf.size === 0 && !K.pin(null, P.anchors, P.next, () => -1).changed, "no zones: no keys, nothing pinned");
R = K.resolve(Z, P.anchors, P.next, at(Z));
check(keysAt(Z, R, [50, 150, 250, 350]) === "z1,z2,z3,z4", "the zones are back: so are their keys");

// 7. dormant anchors are capped, live ones never dropped
const many = [...P.anchors, ...Array.from({ length: 30 }, (_, i) => [`old${i}`, 5000 + i, 5000])];
P3 = K.pin(Z, many, 5, at(Z), 10);
check(P3.anchors.length === 10 && ["z1", "z2", "z3", "z4"].every((k) => P3.anchors.some((a) => a[0] === k)) && P3.anchors.some((a) => a[0] === "old29") && !P3.anchors.some((a) => a[0] === "old0"), "the cap drops the oldest sleeping anchors only");

// 8. stored anchors are cleaned: bad keys, bad numbers, a second anchor of the same key
const c = K.cleanAnchors([["z1", 1, 2], ["z1", 3, 4], ["@sky", 1, 1], ["a|b", 1, 1], ["ok_2", 1, NaN], [5, 1, 1], null, ["hall-A", 7, 8]]);
check(JSON.stringify(c) === JSON.stringify([["z1", 1, 2], ["hall-A", 7, 8]]), `cleanAnchors: ${JSON.stringify(c)}`);

// 9. the scene flag: an old flag decodes with no keys and encodes without new fields; keys survive a round trip
const flag = (f) => ({ flags: { [MODULE_ID]: { [Model.FLAG]: f } } });
const old = { v: 1, s: [[1, [0, 0, 10, 10]]], next: 2, preset: null, lookFrom: null, snap: 0.25, smooth: 0.3, look: {}, w: [], m: [[5, 5, { building: true }]] };
let S = Model.load(flag(old));
check(S.keys.length === 0 && S.keyNext === 1 && !("k" in Model.encode(S)) && !("kn" in Model.encode(S)), "an old flag: no keys, and its encoding gets no new fields");
S.keys = P.anchors; S.keyNext = P.next;
const S2 = Model.canonical(S);
check(JSON.stringify(S2.keys) === JSON.stringify(P.anchors) && S2.keyNext === 5 && Model.encode(S2).k.length === 4, "keys survive encode -> load");
check(JSON.stringify(Model.load(flag({ ...old, m: [[5, 5, { building: true, empty: true, tags: ["metal", "junk", "power", "metal"], terrain: "none" }]] })).marks[0][2]) === JSON.stringify({ building: true, empty: true, tags: ["power", "metal"], terrain: "none" }), "zone attributes: empty and resource tags are stored, unknown tags dropped, order fixed");

console.log(failed ? `${failed} failed` : "all zones keys checks passed");
process.exit(failed ? 1 : 0);
