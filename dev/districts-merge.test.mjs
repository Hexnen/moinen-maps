// Two GMs painting districts at once keep both:   node dev/districts-merge.test.mjs
// A model of Foundry's scene.update on flags (dot keys, ForcedDeletion, objects merged, arrays replaced), two editors that read the same
// scene, edit, and save one after the other: nothing either of them painted is lost (12 painted, 12 kept; it was 10).
class ForcedDeletion {}
globalThis.foundry = { data: { operators: { ForcedDeletion } }, utils: { deepClone: (v) => structuredClone(v) } };
const { listOf, updateFor, patchFor } = await import("../scripts/districts-store.mjs");
const MID = "moinen-maps", P = `flags.${MID}`;
let n = 0;
const ok = (c, m) => { if ( !c ) { console.error(`FAIL ${m}`); process.exit(1); } n++; };

function setPath(o, keys, v) {
  const k = keys[0];
  if ( keys.length === 1 ) { if ( v instanceof ForcedDeletion ) delete o[k]; else o[k] = structuredClone(v); return; }
  if ( typeof o[k] !== "object" || o[k] === null || Array.isArray(o[k]) ) o[k] = {};
  setPath(o[k], keys.slice(1), v);
}
const apply = (scene, upd) => { for ( const [k, v] of Object.entries(upd) ) setPath(scene, k.split("."), v); };
const ring = (x) => [x, 0, x + 10, 0, x + 10, 10, x, 10];
const dist = (id, x) => ({ id, name: id, color: "#f00", rings: [ring(x)], revealed: false });

// a scene from before: the array
const scene = { flags: { [MID]: { districts: [dist("dA", 0), dist("dB", 50)] } } };
let F = () => scene.flags[MID];
ok(listOf(F()).map((d) => d.id).join() === "dA,dB", "a scene from before: the array is read");

// GM 1 and GM 2 read the same scene, each paints 6 new districts
const base1 = structuredClone(listOf(F())), base2 = structuredClone(listOf(F()));
const list1 = structuredClone(base1), list2 = structuredClone(base2);
for ( let i = 0; i < 6; i++ ) { list1.push(dist(`g1_${i}`, 100 + i)); list2.push(dist(`g2_${i}`, 200 + i)); }
apply(scene, updateFor(F(), list1, base1, P));
ok(F().districts === undefined && Object.keys(F().districtsById).length === 8, "the first save writes every district to its key and removes the array");
apply(scene, updateFor(F(), list2, base2, P));          // GM 2 saves on top of GM 1 without having seen it
const ids = listOf(F()).map((d) => d.id);
ok(ids.length === 14 && ids.filter((i) => i.startsWith("g1_")).length === 6 && ids.filter((i) => i.startsWith("g2_")).length === 6, `12 painted, 12 kept (${ids.length} districts)`);
ok(ids.includes("dA") && ids.includes("dB"), "the districts that were there stay");

// edits of different districts by the two at once; one deletes, one recolours
const b1 = structuredClone(listOf(F())), b2 = structuredClone(listOf(F()));
const l1 = structuredClone(b1), l2 = structuredClone(b2);
l1.splice(l1.findIndex((d) => d.id === "dA"), 1);                        // GM 1 erases dA
l2.find((d) => d.id === "dB").color = "#0f0";                            // GM 2 recolours dB
apply(scene, updateFor(F(), l1, b1, P));
apply(scene, updateFor(F(), l2, b2, P));
const now = listOf(F());
ok(!now.some((d) => d.id === "dA") && now.find((d) => d.id === "dB").color === "#0f0" && now.length === 13, "one erases a district, the other recolours another: both stand");
// GM 2 (stale) saves a list that still has the district GM 1 deleted, unchanged: it must not come back
const b3 = structuredClone(listOf(F())), l3 = structuredClone(b3);
const gone = l3.splice(l3.findIndex((d) => d.id === "g1_0"), 1);
const staleList = structuredClone(b3); staleList.find((d) => d.id === "g2_0").name = "renamed";
apply(scene, updateFor(F(), l3, b3, P));
apply(scene, updateFor(F(), staleList, b3, P));
ok(!listOf(F()).some((d) => d.id === "g1_0") && listOf(F()).find((d) => d.id === "g2_0").name === "renamed", `a deleted district (${gone[0].id}) does not come back from a stale save`);
// nothing changed: nothing written
const bN = structuredClone(listOf(F()));
ok(Object.keys(updateFor(F(), structuredClone(bN), bN, P)).length === 0, "a save with nothing changed writes nothing");
// the order is kept
const ord = listOf(F()).map((d) => d.id), rev = structuredClone(listOf(F())).reverse();
apply(scene, updateFor(F(), rev, structuredClone(listOf(F())), P));
ok(listOf(F()).map((d) => d.id).join() === ord.slice().reverse().join(), "the order of the districts is kept");
// the attribute publisher writes one district's attrs only
const upd = patchFor(F(), "dB", { attrs: [{ id: "a", name: "x", value: 1 }] }, P);
ok(Object.keys(upd).join() === `${P}.districtsById.dB.attrs`, "attrs: one key of one district");
apply(scene, upd);
ok(listOf(F()).find((d) => d.id === "dB").attrs[0].name === "x" && listOf(F()).length === 12, "attrs written, the others untouched");
const legacy = { flags: { [MID]: { districts: [dist("q", 0)] } } };
const lu = patchFor(legacy.flags[MID], "q", { attrs: [] }, P);
ok(Array.isArray(lu[`${P}.districts`]), "attrs on a scene from before: the array way");
console.log(`districts-merge: ${n} checks ok`);
