// Whole-object flag writes REPLACE, never merge:   node dev/flag-replace.test.mjs
// A scene update merges an object value into the stored one key by key, at every depth. A save that writes a whole flag object
// (the zones' `flags.moinen-maps.zones`, the weather's params, a manifest, ...) without the keys it no longer has left them on the
// scene: the live view dropped them, a reload (or another client) brought them back - the zones' last door record (bs) and last zone
// state (q) came back after a reload (D203). flag-diff.mjs replacing() / put() write such a value with every key it lacks deleted.
//   1. the cause, against Foundry's own update code (the install is found by FOUNDRY_APP or the default Windows path; without it a
//      small model of the same merge is used): writing the encoded zones over a flag that had bs / q / e keeps them;
//   2. the zones: every key encode() can leave out (found by comparing a full set with a blank one, so a key added later is covered),
//      removed alone and all together, survives a "reload" (the stored source read back as JSON): the stored flag equals encode() exactly;
//      a key of an older version is dropped too; a removal inside an array (one of two door records) is kept as well;
//   3. nested: the weather's base losing an effect and its drift, the storm going, a manifest's chunk map losing an id;
//      setChanged / syncMap (the incremental writers) delete what a changed object lost;
//   4. without Foundry's operator replacing() falls back to "-=" keys; with it no deprecated syntax is used (no compatibility warning);
//   5. source pins: the zones, roads, weather, fire, water, manifests, cinematic, orbit and title-card writes go through put()/saveUpdate,
//      and no other whole-object write of a module flag is left in scripts/ (an allow-list names the array / primitive ones).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MID = "moinen-maps";
let failed = 0, n = 0;
const check = (ok, msg) => { n++; if ( !ok ) { failed++; console.log(`FAIL ${msg}`); } else if ( process.argv.includes("-v") ) console.log(`ok   ${msg}`); };
const J = (v) => JSON.stringify(v);
const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
const same = (a, b) => J(sorted(a)) === J(sorted(b));

/* ---------------------------------------------------------------- a scene document: Foundry's own, or a model of its merge */
const apps = [process.env.FOUNDRY_APP, "C:/Program Files/Foundry Virtual Tabletop/resources/app"].filter(Boolean);
const app = apps.find((a) => fs.existsSync(path.join(a, "common/server.mjs")));
const warnings = [];
let makeScene, real = false;
globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call() {} };
if ( app ) {
  const F = await import(pathToFileURL(path.join(app, "common/server.mjs")).href);
  globalThis.foundry = { ...F };
  globalThis.CONST = F.CONST;
  globalThis.logger = { warn: (m) => warnings.push(String(m?.message ?? m)), error: (m) => warnings.push(String(m?.message ?? m)), info() {}, log() {} };
  class Doc extends F.abstract.DataModel { static defineSchema() { return { flags: new F.data.fields.DocumentFlagsField() }; } }
  makeScene = (flags) => {
    const d = new Doc({ flags: structuredClone(flags) });
    // `flags` is what a reload reads: the stored source, as JSON
    return { get flags() { return JSON.parse(JSON.stringify(d._source.flags)); }, update(u) { d.updateSource(u); } };
  };
  real = true;
} else {
  class ForcedDeletion {}
  globalThis.foundry = { data: { operators: { ForcedDeletion } }, utils: { deepClone: (v) => structuredClone(v) } };
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v) && !(v instanceof ForcedDeletion);
  const strip = (v) => Object.fromEntries(Object.entries(v).filter(([k, x]) => !k.startsWith("-=") && !(x instanceof ForcedDeletion)).map(([k, x]) => [k, isObj(x) ? strip(x) : x]));
  const merge = (o, k, v) => {
    if ( k.startsWith("-=") ) { delete o[k.slice(2)]; return; }
    if ( v instanceof ForcedDeletion ) { delete o[k]; return; }
    if ( isObj(v) && isObj(o[k]) ) { for ( const [kk, vv] of Object.entries(v) ) merge(o[k], kk, vv); return; }
    o[k] = isObj(v) ? strip(v) : structuredClone(v);
  };
  makeScene = (flags) => {
    const src = { flags: structuredClone(flags) };
    return { get flags() { return JSON.parse(JSON.stringify(src.flags)); }, update(u) {
      for ( const [key, val] of Object.entries(u) ) {
        const parts = key.split("."), last = parts.pop();
        let o = src; for ( const p of parts ) { if ( !isObj(o[p]) ) o[p] = {}; o = o[p]; }
        merge(o, last, val);
      }
    } };
  };
}
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const FD = await imp("scripts/flag-diff.mjs");
const Model = await imp("scripts/zones/model.mjs");
const WM = await imp("scripts/weather/model.mjs");

/* ---------------------------------------------------------------- 1. the cause */
const fullFlag = {
  v: 1, s: [[1, [0, 0, 100, 0, 100, 100]], [2, [0, 50, 200, 50]]], next: 3, preset: null, lookFrom: null, snap: 0.25, smooth: 0.3,
  look: Model.cleanLook(), w: [[50, 0, "door"], [100, 50, "wall"]], m: [[20, 20, { building: true }]],
  k: [["z1", 20, 20], ["z2", 150, 20]], kn: 3,
  bs: [[50, 0, { d: "open" }], [100, 50, { w: "breached" }]],
  q: [[20, 20, { id: "s1", kind: "fire", level: 2 }], [150, 20, { id: "s2", kind: "smoke" }]],
  e: [{ id: "e3", kind: "portal", a: "z1", b: "z2" }],
  pn: 4
};
const flagsWith = (f) => ({ [MID]: { zones: structuredClone(f), other: { keep: 1 } } });
const S0 = Model.load({ flags: flagsWith(fullFlag) });
check(S0.plays.length === 2 && S0.states.length === 2 && S0.edges.length === 1 && S0.keys.length === 2, "the full set decodes with its door records, states, edge and keys");
{
  const sc = makeScene(flagsWith(fullFlag)), S = Model.canonical(S0);
  S.plays = []; S.states = []; S.edges = [];
  sc.update({ [`flags.${MID}.zones`]: Model.encode(S) });           // the old save
  const back = Model.load(sc);
  check(back.plays.length === 2 && back.states.length === 2 && back.edges.length === 1,
    `the cause${real ? " (Foundry's own update)" : " (merge model)"}: the old whole-object write keeps the removed bs / q / e after a reload`);
}

/* ---------------------------------------------------------------- 2. the zones: every key encode() can leave out */
const optional = Object.keys(Model.encode(S0)).filter((k) => !(k in Model.encode(Model.blank())));
check(["bs", "q", "e", "k", "kn", "pn"].every((k) => optional.includes(k)), `encode() leaves out ${optional.join(", ")} when empty (all covered below)`);
const emptyOf = { bs: (S) => { S.plays = []; }, q: (S) => { S.states = []; }, e: (S) => { S.edges = []; }, pn: (S) => { S.playNext = 1; },
  k: (S) => { S.keys = []; S.keyNext = 1; }, kn: (S) => { S.keys = []; S.keyNext = 1; } };
check(optional.every((k) => emptyOf[k]), "every optional key has a way to empty it in this test (a new one must be added here)");
const cases = [...optional.map((k) => [k]), optional, ["bs", "q"]];
for ( const keys of cases ) {
  const sc = makeScene(flagsWith(fullFlag)), S = Model.canonical(S0);
  for ( const k of keys ) emptyOf[k]?.(S);
  sc.update(Model.saveUpdate(S, sc));
  const stored = sc.flags[MID].zones, back = Model.load(sc);
  check(same(stored, Model.encode(S)), `removing ${keys.join(" + ")}: the stored flag after a reload is exactly the encoded set`);
  check(keys.every((k) => !(k in stored)), `removing ${keys.join(" + ")}: the key is gone from the scene`);
  check(same(Model.encode(back), Model.encode(S)), `removing ${keys.join(" + ")}: a reload decodes the set as it was saved`);
  check(sc.flags[MID].other?.keep === 1, `removing ${keys.join(" + ")}: the module's other flags are untouched`);
}
{
  // one of two door records goes, one state changes: arrays replace
  const sc = makeScene(flagsWith(fullFlag)), S = Model.canonical(S0);
  S.plays = S.plays.slice(0, 1); S.states = [[S.states[0][0], S.states[0][1], { ...S.states[0][2], level: 3 }]];
  sc.update(Model.saveUpdate(S, sc));
  check(same(sc.flags[MID].zones, Model.encode(S)) && Model.load(sc).plays.length === 1 && Model.load(sc).states.length === 1, "one of two door records and one of two states removed: kept after a reload");
}
{
  // a key an older version wrote, and a stale key inside the look
  const sc = makeScene(flagsWith({ ...fullFlag, zz: [1], look: { ...fullFlag.look, oldThing: 1 } })), S = Model.canonical(S0);
  sc.update(Model.saveUpdate(S, sc));
  check(same(sc.flags[MID].zones, Model.encode(S)), "keys no encode() writes (an older version's, one inside the look) are dropped by the next save");
}
{
  // removed, then added back, then removed again: each step as saved
  const sc = makeScene(flagsWith(fullFlag)), S = Model.canonical(S0);
  const steps = [() => { S.plays = []; }, () => { S.plays = [[50, 0, { d: "closed" }]]; }, () => { S.states = []; S.edges = []; }, () => { S.plays = []; }];
  let ok = true;
  for ( const st of steps ) { st(); sc.update(Model.saveUpdate(S, sc)); ok &&= same(sc.flags[MID].zones, Model.encode(S)); }
  check(ok, "a run of removals and additions: after every save the stored flag is the encoded set");
}
{
  // the first save on a scene without the flag
  const sc = makeScene({ [MID]: {} }), S = Model.canonical(S0);
  sc.update(Model.saveUpdate(S, sc));
  check(same(sc.flags[MID].zones, Model.encode(S)), "the first save on a scene without zones stores the set");
}

/* ---------------------------------------------------------------- 3. nested values */
{
  // the weather: a base with rain and a drift becomes one without them; the storm goes
  const before = WM.cleanParams({ base: { t: 5, fx: { rain: 2, fog: 1 }, wind: {}, wet: 0.5, cover: 0.2, drift: [3, 4] }, storm: { on: true, t: 9 } });
  const after = WM.cleanParams({ ...before, base: { t: 9, fx: { fog: 1 }, wind: before.base.wind, wet: 0, cover: 0 }, storm: undefined });
  check(before.base.drift && before.base.fx.rain && before.storm && !after.base.drift && !after.base.fx.rain && !("storm" in after), "weather: the new params lack the drift, the rain and the storm");
  const sc = makeScene({ [MID]: { weather: before } });
  sc.update({ [`flags.${MID}.weather`]: after });
  const kept = sc.flags[MID].weather;
  check(!!kept.base.drift && !!kept.base.fx.rain && !!kept.storm, `weather: the old whole-object write keeps them${real ? " (Foundry's own update)" : ""}`);
  const sc2 = makeScene({ [MID]: { weather: before } });
  sc2.update(FD.put({}, `flags.${MID}.weather`, sc2.flags[MID].weather, after));
  check(same(sc2.flags[MID].weather, after), "weather: put() stores exactly the new params (no drift, no rain, no storm)");
}
{
  // a manifest whose chunk map loses an id (rim-store: it never compared "same" again)
  const old = { v: 2, rv: 1, dir: "d", t: ["a", "b"], h: { a: ["h1"], b: ["h2"] }, at: 1 }, next = { v: 2, rv: 1, dir: "d", t: ["b"], h: { b: ["h2"] }, at: 2 };
  const sc = makeScene({ [MID]: { rims: old } });
  sc.update(FD.put({}, `flags.${MID}.rims`, sc.flags[MID].rims, next));
  check(same(sc.flags[MID].rims, next), "a manifest's chunk map: the dropped id is deleted");
}
{
  // setChanged / syncMap: a changed object loses a key
  const stored = { params: { a: 1, b: 2, deep: { x: 1, y: 2 } }, c: { s1: { k: 1, opt: 3 }, s2: { k: 2 } } };
  const next = { params: { a: 1, deep: { x: 1 } }, c: { s1: { k: 1 } } };
  const sc = makeScene({ [MID]: { d: stored } });
  const upd = {};
  FD.setChanged(upd, `flags.${MID}.d`, sc.flags[MID].d, next, ["params"]);
  FD.syncMap(upd, `flags.${MID}.d.c`, sc.flags[MID].d.c, next.c);
  sc.update(upd);
  check(same(sc.flags[MID].d, next), "setChanged / syncMap: keys a changed object lost are deleted (at depth too)");
}
{
  const a = { x: [1, 2], y: null, z: "s" }, r = FD.replacing({ x: [1, 2, 3], y: { q: 1 }, z: { p: 1 }, w: 1 }, a);
  check(J(r.x) === "[1,2]" && r.y === null && r.z === "s" && r.w instanceof globalThis.foundry.data.operators.ForcedDeletion, "replacing(): arrays, null and values replace; a lost key becomes a deletion");
  check(J(FD.replacing(undefined, a)) === J(a) && FD.replacing({ a: 1 }, 5) === 5, "replacing(): nothing stored, or a non-object value: the value as it is");
  check(!("w" in a), "replacing() does not change the value it is given");
}

/* ---------------------------------------------------------------- 4. the fallback, and no deprecated syntax */
{
  const keep = globalThis.foundry;
  globalThis.foundry = undefined;
  const r = FD.replacing({ a: 1, b: { c: 1, d: 2 } }, { b: { c: 1 } });
  globalThis.foundry = keep;
  check(r["-=a"] === null && r.b["-=d"] === null && !("a" in r), "without Foundry's operator: the \"-=\" deletion keys");
}
check(!warnings.some((w) => /deletion|ForcedDeletion|no longer supported/i.test(w)), `no compatibility warning from Foundry's update (${warnings.length} logged)`);

/* ---------------------------------------------------------------- 5. source pins */
const src = (p) => fs.readFileSync(path.join(root, p), "utf8");
const zs = src("scripts/zones/zones.mjs"), save = zs.slice(zs.indexOf("export async function save()"), zs.indexOf("function flushSave()"));
check(/scene\.update\(Model\.saveUpdate\(S, scene\)\)/.test(save) && !/\[`flags\.\$\{MODULE_ID\}\.\$\{Model\.FLAG\}`\]: payload/.test(save), "zones save() writes Model.saveUpdate (not the bare payload)");
const pins = {
  "scripts/roads/roads.mjs": /put\(\{\}, `flags\.\$\{MODULE_ID\}\.\$\{Model\.FLAG\}`/,
  "scripts/weather/weather.mjs": /function save\(\) \{ return write\(put\(\{\}, flagKey,/,
  "scripts/fire/fire.mjs": /write\(put\(\{\}, `flags\.\$\{MODULE_ID\}\.\$\{M\.FLAG\}`/,
  "scripts/water/water.mjs": /put\(\{\}, `flags\.\$\{MODULE_ID\}\.\$\{Model\.FLAG\}\.baked`/,
  "scripts/destruction/rim-store.mjs": /put\(\{\}, `flags\.\$\{MODULE_ID\}\.\$\{KEY\}`/,
  "scripts/destruction/composite.mjs": /put\(\{\}, `flags\.\$\{MODULE_ID\}\.\$\{KEY\}`/,
  "scripts/net/bundle.mjs": /put\(\{\}, `flags\.\$\{MODULE_ID\}\.\$\{KEY\}`/,
  "scripts/destruction/cinematic.mjs": /put\(\{\}, `flags\.\$\{MODULE_ID\}\.\$\{FLAG\}\.\$\{game\.user\.id\}`/,
  "scripts/zones/orbit.mjs": /put\(\{\}, `flags\.\$\{MODULE_ID\}\.orbitReq`/,
  "scripts/director/scene-panel.mjs": /put\(\{\}, `flags\.\$\{MODULE_ID\}\.\$\{FLAG\}`/
};
for ( const [f, re] of Object.entries(pins) ) check(re.test(src(f)), `${f}: the whole-object flag write goes through put()`);
// no other whole-object write of a module flag: setFlag with an object, or update({ [`flags.<module>...`]: value }) that is not a deletion
const ALLOW = [
  /attrs\.mjs: .*store\.\$\{scene\.id\}\.\$\{districtId\}`\]: clean/            // an array (the attribute list): arrays replace
];
const files = []; (function walk(d) { for ( const e of fs.readdirSync(d, { withFileTypes: true }) ) { const p = path.join(d, e.name); if ( e.isDirectory() ) walk(p); else if ( p.endsWith(".mjs") ) files.push(p); } })(path.join(root, "scripts"));
const bad = [];
for ( const f of files ) {
  const rel = path.relative(path.join(root, "scripts"), f).replaceAll("\\", "/");
  src(path.relative(root, f)).split("\n").forEach((line, i) => {
    const hit = /\.setFlag\(\s*MODULE_ID\s*,[^)]*\{/.test(line) || /\.setFlag\("moinen-maps"\s*,[^)]*\{/.test(line)
      || /update\(\{\s*\[`flags\.\$\{MODULE_ID\}[^`]*`\]:\s*(?!null\b)[A-Za-z_{]/.test(line);
    if ( hit && !/-=/.test(line.match(/\[`flags[^`]*`\]/)?.[0] ?? "") && !ALLOW.some((re) => re.test(`${rel}: ${line}`)) ) bad.push(`${rel}:${i + 1}`);
  });
}
check(!bad.length, `no other whole-object module flag write in scripts/ (${bad.join(", ") || "none"})`);

console.log(failed ? `${failed} of ${n} checks failed` : `flag-replace: ${n} checks ok${real ? " (Foundry's own update)" : " (merge model: Foundry install not found)"}`);
process.exit(failed ? 1 : 0);
