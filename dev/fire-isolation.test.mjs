// Fire and smoke: an edit touches ONLY the area(s) it overlaps (the pure part):   node dev/fire-isolation.test.mjs
//   A. areas: painting elsewhere, adding onto / erasing in / re-levelling / re-colouring one fire keeps every other area's id AND key
//      (the display keeps a mesh, field, art state and lights exactly while the key is the same)
//   B. lights: FireLights.syncAreas replaces the sources of the changed / new / gone areas only; new light settings rebuild all
//   C. the art is WORLD-anchored: the ART and FUEL shaders read the area's origin (uOrg) and the display seeds the art by colour, not by
//      the area id, so a rebuilt area (new rect, new id) keeps its pattern where it was - no visible reset on the swap
// The live counterpart (lane, real meshes and light sources): dev/fire-isolation.mjs
import * as M from "../scripts/fire/model.mjs";
import { readFileSync } from "node:fs";

let fails = 0, n = 0;
const ok = (c, msg) => { n++; if ( !c ) { fails++; console.log(`FAIL ${msg}`); } };
const geo = { ap: 3, ox: 100, oy: 100, grid: 96 };
const P = M.cleanParams();
const st = (id, x, y, extra = {}) => M.cleanStroke({ id, k: "fire", s: 0.9, r: 40, p: [x, y, x + 60, y + 10], wd: 0, ws: 0, q: 1, lv: 2, sm: 1, ...extra });

/* A */
const base = [st("s1", 300, 300), st("s2", 900, 300), st("s3", 1500, 300), st("b1", 300, 900), st("b2", 420, 905), st("b3", 540, 900)];
const at = (list) => new Map(M.areasOf(list, geo, P, undefined, true).map((a) => [a.id, a]));
const A0 = at(base);
ok(A0.size === 4, `four areas (${A0.size})`);
const same = (A, ids) => ids.every((id) => A.get(id)?.key === A0.get(id).key);
const others = ["s1", "s2", "s3"];
const cases = {
  paintElsewhere: [...base, st("n1", 2000, 1200)],
  addOntoBig: [...base, st("a1", 470, 920, { lv: 3, sm: 2 })],
  eraseInBig: [...base, M.cleanStroke({ id: "e1", k: "erase", s: 1, r: 30, p: [450, 905], q: 1 })],
  levelOfBig: base.map((s) => (s.id === "b2" ? { ...s, lv: 3 } : s)),
  colourOfS1: base.map((s) => (s.id === "s1" ? { ...s, c: "#3a7bff" } : s))
};
for ( const [name, list] of Object.entries(cases) ) {
  const A = at(list);
  const keep = name === "colourOfS1" ? ["s2", "s3", "b1"] : name === "paintElsewhere" ? [...others, "b1"] : others;
  ok(same(A, keep), `${name}: untouched areas keep id and key`);
  if ( name !== "paintElsewhere" ) ok([...A.values()].some((a) => !A0.has(a.id) || A0.get(a.id).key !== a.key), `${name}: the touched area changes`);
}

// a stroke added onto a burning fire: the old bed's own distance and level are kept (art.mjs blends them while the new ground
// catches: the burning part never jumps); nothing catching -> none
{
  const big = [st("b1", 300, 900), st("b2", 420, 905)];
  const at0 = M.areasOf(big, geo, P, undefined, true)[0];
  ok(M.raster(at0, geo, P).auxOld == null, "auxOld: none at rest");
  const T0 = 1.8e12, add = st("a1", 470, 905, { lv: 3, q: T0 });
  const ar = M.areasOf([...big, add], geo, P, T0 + 50).find((a) => a.strokes.some((s) => s.id === "a1"));
  const f = ar ? M.raster(ar, geo, P) : null;
  ok(f?.auxOld?.length === f?.w * f?.h * 4, "auxOld: present while a stroke added onto a burning fire catches");
  if ( f?.auxOld ) {
    let raised = 0, shorter = 0;
    for ( let i = 0; i < f.w * f.h; i++ ) { if ( f.auxOld[i * 4 + 1] === 2 ) raised++; if ( f.auxOld[i * 4] > 0 && f.auxOld[i * 4] < f.aux[i * 4] ) shorter++; }
    ok(raised > 0, `auxOld: the burning cells the lv 3 stroke raised keep their old level 2 (${raised})`);
    ok(shorter > 0, `auxOld: the old edge keeps its shorter inside distance (${shorter})`);
  }
}

/* B */
globalThis.Hooks = { on: () => 0, off: () => 0 };
let refreshes = 0;
globalThis.canvas = { environment: { darknessLevel: 1 }, effects: { lightSources: new Map() }, perception: { update: () => refreshes++ } };
globalThis.foundry = { canvas: { sources: { PointLightSource: class {} } } };
globalThis.game = globalThis.game ?? { settings: { get: () => false } };
let L = null;
try { L = await import("../scripts/fire/lights.mjs"); } catch ( e ) { ok(false, `lights.mjs imports in node (${e.message})`); }
if ( L ) {
  const lights = new L.FireLights();
  let made = 0;
  lights.make = (id, list) => list.map((_, i) => ({ id: `${id}.${i}.${made++}`, suppression: {} }));
  lights.drop = (list) => list.length;
  const entries = (A) => [...A.values()].map((a) => ({ id: a.id, key: a.key, list: [1, 2] }));
  const LP = { ...P, light: true };
  lights.syncAreas(entries(A0), LP);
  const before = new Map([...lights.byArea].map(([id, a]) => [id, a.sources]));
  const r = lights.syncAreas(entries(at(cases.addOntoBig)), LP);
  ok(others.every((id) => lights.byArea.get(id).sources === before.get(id)), "lights: untouched areas keep their sources (same objects)");
  ok(r.made === 2 && r.dropped === 2, `lights: only the touched area's sources replaced (made ${r.made}, dropped ${r.dropped})`);
  const r2 = lights.syncAreas(entries(at(cases.addOntoBig)), LP);
  ok(r2.made === 0 && r2.dropped === 0, "lights: nothing changed, nothing made, no refresh needed");
  const r3 = lights.syncAreas(entries(at(cases.addOntoBig)), { ...LP, lightRadius: (LP.lightRadius ?? 1) + 1 });
  ok(r3.made === 8 && r3.dropped === 8, "lights: new light settings rebuild every area");
}

/* C */
const art = readFileSync(new URL("../scripts/fire/art.mjs", import.meta.url), "utf8");
const disp = readFileSync(new URL("../scripts/fire/display.mjs", import.meta.url), "utf8");
const block = (name) => art.slice(art.indexOf(`const ${name} = \``), art.indexOf("`;", art.indexOf(`const ${name} = \``)));
ok(/uniform vec2 uOrg;/.test(block("ART")) && /vCell \+ uOrg/.test(block("ART")), "ART samples world cells (uOrg)");
ok(/uniform vec2 uOrg;/.test(block("FUEL")) && /\+ uOrg/.test(block("FUEL")), "FUEL samples world cells (uOrg)");
ok(!/\buArea\b/.test(block("ART")),"ART has no whole-area clock (per-cell clocks only)");
ok(/new FireArt\([^)]*seed: M\.hashStr\("art:"/.test(disp), "the display seeds the art by colour, not by the area id");
const s0 = disp.indexOf("  sync("), syncBody = disp.slice(s0, disp.indexOf("\n  }\n", s0));
ok(syncBody.length > 100 && !/tick\(true\)/.test(syncBody), "a sync does not force every area to re-render");

console.log(`${n - fails}/${n} isolation checks passed`);
process.exit(fails ? 1 : 0);
