// Zones: the public API a combat module calls, wired through scripts/zones/zones.mjs with a stand-in Foundry (no canvas, no PIXI):
// stable keys through edits and undo, places of tokens, tokensInZone / zonesWithin / range / route / path / borderBetween, the
// "moinenMapsZoneEvent" payloads, the GM check of setZone / clearStates.   node dev/zones-api.test.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
const MOD = "moinen-maps";

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if ( !ok ) failed++; };
const J = JSON.stringify;

/* ---- a stand-in Foundry: hooks, settings, one scene with tokens; anything drawn is a stub that swallows every call */
const stub = () => new Proxy(class Stub { constructor() { return new Proxy(this, { get: (t, k) => (k in t ? t[k] : typeof k === "symbol" ? undefined : stub()) }); } },
  { get: (t, k) => (k in t ? t[k] : typeof k === "symbol" ? undefined : k === "prototype" ? t.prototype : stub()), apply: () => stub() });
const hooks = new Map();
globalThis.Hooks = {
  on(name, fn) { if ( !hooks.has(name) ) hooks.set(name, []); hooks.get(name).push(fn); return fn; },
  once(name, fn) { return this.on(name, fn); },
  off(name, fn) { const l = hooks.get(name); if ( l?.includes(fn) ) l.splice(l.indexOf(fn), 1); },
  callAll(name, ...args) { for ( const fn of [...(hooks.get(name) ?? [])] ) fn(...args); return true; }
};
const settings = new Map();
globalThis.PIXI = stub();
globalThis.foundry = stub();
globalThis.CONFIG = {};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.document = { addEventListener() {}, visibilityState: "visible", body: { append() {} }, createElement: () => stub() };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.ui = { notifications: { info() {}, warn() {} } };
globalThis.game = {
  user: { isGM: true, id: "gm" },
  i18n: { lang: "en", localize: (k) => k, format: (k) => k, has: () => false },
  settings: { register: (m, k, o) => settings.set(k, o.default), get: (m, k) => { if ( !settings.has(k) ) throw new Error(`no setting ${k}`); return settings.get(k); } },
  scenes: { get: () => scene },
  modules: { get: () => ({}) }
};

const expand = (flat) => { const o = {}; for ( const [k, v] of Object.entries(flat) ) { const ps = k.split("."); let t = o; ps.slice(0, -1).forEach((p) => { t = t[p] ??= {}; }); t[ps.at(-1)] = v; } return o; };
const applyFlags = (flags, ch) => { for ( const [k, v] of Object.entries(ch ?? {}) ) { if ( k.startsWith("-=") ) delete flags[k.slice(2)]; else flags[k] = v; } };
let scene = null;
function makeScene(flag, tokens = []) {
  const s = { id: "scene1", flags: { [MOD]: flag ? { zones: flag } : {} }, saves: 0 };
  s.update = async (data) => { s.saves++; for ( const [k, v] of Object.entries(data) ) if ( k === `flags.${MOD}.zones` ) s.flags[MOD].zones = JSON.parse(JSON.stringify(v)); return s; };
  s.tokens = tokens.map(([id, x, y, fl]) => makeToken(s, id, x, y, fl));
  return s;
}
function makeToken(s, id, x, y, fl = {}) {
  const d = { id, uuid: `Scene.${s.id}.Token.${id}`, x, y, width: 1, height: 1, actorId: `actor-${id}`, isOwner: true, parent: s, documentName: "Token", flags: { [MOD]: { ...fl } }, object: null };
  d.getFlag = (m, k) => d.flags[m]?.[k];
  d.update = async (flat) => {
    const ch = expand(flat);
    for ( const k of ["x", "y"] ) if ( k in ch ) d[k] = ch[k];
    applyFlags(d.flags[MOD], ch.flags?.[MOD]);
    Hooks.callAll("updateToken", d, ch, {}, game.user.id);
    return d;
  };
  d.unsetFlag = (m, k) => d.update({ [`flags.${m}.-=${k}`]: null });
  d.setFlag = (m, k, v) => d.update({ [`flags.${m}.${k}`]: v });
  return d;
}
function open(s) {
  scene = s;
  const any = new (stub())();
  globalThis.canvas = new Proxy({
    scene: s, ready: true, dimensions: { size: 100, sceneRect: { x: 0, y: 0, width: 800, height: 200 } }, grid: { size: 100 },
    app: { view: { addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) }, ticker: { add() {}, remove() {} }, renderer: any },
    tokens: { controlled: [], placeables: [] }, stage: { scale: { x: 1 } }
  }, { get: (t, k) => (k in t ? t[k] : any) });
  Hooks.callAll("canvasReady");
}

const Zones = await imp("scripts/zones/zones.mjs");
const { api: moduleApi } = await imp("scripts/attrs.mjs");
let painted = 0, removed = 0;
moduleApi.fire = { paint: () => { painted++; return "f1"; } };
Zones.registerZones();
Hooks.callAll("init");
const api = Zones.zonesApi;

const events = [];
Hooks.on(api.EVENT_HOOK, (type, payload) => events.push({ type, ...payload }));
const take = () => events.splice(0);

// a row of four zones (dividers at 200, 400, 600 inside the 800 x 200 scene, 100 px squares), stored the way a scene from before keys stores them:
// no `k`, a look of its own that nobody sees (so nothing is drawn here), an exterior wall 0|1 and a building with two floors in zone 1
const oldFlag = {
  v: 1, s: [[1, [200, -20, 200, 220]], [2, [400, -20, 400, 220]], [3, [600, -20, 600, 220]]], next: 4, preset: null, snap: 0.25, smooth: 0,
  look: { who: "none" }, w: [[200, 100, "outer"]], m: [[300, 100, { building: true, floors: 2 }]]
};
const sc = makeScene(oldFlag, [["t1", 0, 0], ["t2", 250, 0, { floor: 2 }], ["t3", 450, 0, { alt: "sky" }], ["t4", 650, 0, { alt: "elevated" }]]);
open(sc);

/* ---- an old scene: keys without a write */
check(api.zones()?.zones.length === 4 && J(api.keys()) === J(["z1", "z2", "z3", "z4"]), `an old scene: four zones, keys ${api.keys()}`);
check(sc.saves === 0 && !("k" in api.state()) && take().length === 0, "opening it writes nothing and tells nothing");
check(api.keyOf(2) === "z3" && api.idOf("z3") === 2 && api.idOf("nope") === -1 && api.keyOf(9) === null, "keyOf / idOf");
const v0 = api.version();

/* ---- places of tokens, tokens in a zone */
const [t1, t2, t3, t4] = sc.tokens;
check(api.zoneOfToken(t1).spot === "z1" && api.zoneOfToken({ document: t2 }).spot === "z2:f2" && api.zoneOfToken(t3).spot === "@sky" && api.zoneOfToken(t3).below === "z3" && api.zoneOfToken(t4).airborne, "zoneOfToken: ground, a floor, sky high, airborne (a document or a placeable)");
check(api.zoneOfToken(t1) === api.zoneOfToken(t1) && Object.isFrozen(api.zoneOfToken(t1)), "a token's place is kept until something changes, and cannot be changed by a caller");
check(api.place("z2:f2").floor === 2 && api.place(1).spot === "z2" && api.place("@orbit").area === "orbit" && api.place("zz") === null && api.placeAt(450, 50, { level: "elevated" }).spot === "z3:elevated" && api.place({ zone: "z2", level: "floor", floor: 1 }).spot === "z2:f1" && api.place(api.zoneOfToken(t4)).airborne, "place(): keys, spots, ids, points, places");
const ids = (l) => l.map((r) => r.token.id).join();
check(ids(api.tokensInZone("z2")) === "t2" && ids(api.tokensInZone("z2:f2")) === "t2" && ids(api.tokensInZone("z2:f1")) === "" && ids(api.tokensInZone(api.place("z2"))) === "" && ids(api.tokensInZone("z2", { anyLevel: false })) === "", "tokensInZone: a bare key is every level, a spot only that level");
check(ids(api.tokensInZone("@sky")) === "t3" && ids(api.tokensInZone("z3")) === "" && ids(api.tokensInZone(t4)) === "t4" && ids(api.tokensInZone("z4:elevated")) === "t4" && ids(api.tokensInZone("z4", { anyLevel: true })) === "t4", "tokensInZone: off the map is its own zone; a token's own zone");

/* ---- distances, routes, borders, zone data */
check(J(api.range(t1, t2)) === J({ borders: 1, levels: 2, total: 3 }) && api.borderDistance(t1, "z4") === 3 && api.range(t1, t3) === null, "range between tokens: borders and levels; none to sky high");
check(api.route(t1, "z2", "walk") === null && api.route(t1, "z3", "air").total === 2 && J(api.distances("z1", "z3")) === J({ range: 2, walk: null, air: 2, through: 2, swim: null, swing: null }), "routes per way of moving; both distances at once");
check(J(api.zonesWithin(t1, 1)) === J([{ zone: "z1", id: 0, d: 0 }, { zone: "z2", id: 1, d: 1 }]) && api.zonesWithin("z1", 3, { way: "walk" }).length === 1, "zonesWithin: range by default, a way of moving on request");
let pth = api.path(t2, "z4");
check(pth.zones.join() === "z2,z3,z4" && pth.total === 4 && pth.crossed.map((b) => b.key).join() === "z2|z3,z3|z4" && pth.steps[0].kind === "level", "path: zones, levels, borders");
check(api.path("z1", "z2", { way: "range" }).crossed[0].blocked === true && api.path("z1", "z2") === null, "path by range crosses the wall; by walking there is none");
let br = api.borderBetween("z2", t1);
check(br.key === "z1|z2" && br.kind === "outer" && br.armor === 3 && api.borderBetween("z1", "z3") === null && api.borderBetween("z1", "z1") === null && api.bordersOf("z2").map((b) => b.key).join() === "z1|z2,z2|z3", "borderBetween / bordersOf");
check(api.zone("z2").building && api.zone("z2").floors === 2 && api.zone(t1).key === "z1" && api.zoneList().length === 4 && api.zone("@sky") === null, "zone data");
check(api.version() === v0, "asking changes nothing");

/* ---- token events */
await t1.update({ x: 20 });
check(take().length === 0, "a move inside the zone tells nothing");
await t1.update({ x: 650 });
let ev = take();
check(ev.length === 2 && ev[0].type === "tokenLeft" && ev[1].type === "tokenEntered" && ev[0].from.zone === "z1" && ev[0].to.zone === "z4" && ev[1].zoneChanged && !ev[1].levelChanged && ev[1].cause === "move" && ev[1].userId === "gm" && ev[1].token === "t1" && ev[1].scene === "scene1" && ev[1].actor === "actor-t1" && ev[1].uuid.endsWith("t1"), `a move to another zone: ${ev.map((e) => e.type)}`);
await api.setLevel(t1, { level: "elevated" });
ev = take();
check(ev.length === 2 && ev[1].to.spot === "z4:elevated" && ev[1].levelChanged && !ev[1].zoneChanged && ev[1].cause === "level" && ids(api.tokensInZone("z4:elevated")) === "t1,t4", "setLevel elevated: a level change is told");
await api.setLevel(t2, { level: "elevated" });
check(api.zoneOfToken(t2).roof && !api.zoneOfToken(t2).airborne && t2.flags[MOD].floor === undefined, "elevated over a building: the rooftop");
await api.setLevel(t2, { level: "elevated", airborne: true });
ev = take();
check(api.zoneOfToken(t2).airborne && ev.at(-1).type === "tokenEntered" && ev.at(-1).from.roof && ev.at(-1).to.airborne && ev.at(-1).from.spot === ev.at(-1).to.spot, "rooftop -> in the air above it: the same spot, still told");
await api.setAltitude(t2, "elevated");
check(api.zoneOfToken(t2).roof && t2.flags[MOD].air === undefined, "setAltitude (the HUD's) clears the airborne note");
await api.setLevel(t2, "z9:f1"); check(api.zoneOfToken(t2).spot === "z2:f1", "setLevel by a spot string (the zone part is not used)");
await api.setLevel(t2, { level: "floor", floor: 7 }); check(api.zoneOfToken(t2).spot === "z2", "a floor the building does not have: the ground");
await api.setLevel(t2, { level: "underground" }); check(api.zoneOfToken(t2).spot === "z2:underground" && api.altitude(t2) === "ground", "underground (the old altitude reads it as ground)");
await api.setLevel(t2, { area: "chase" }); check(api.zoneOfToken(t2).spot === "@chase" && ids(api.tokensInZone("@chase")) === "t2", "off the map into a chase");
await api.setLevel(t2, { level: "ground" }); check(J(t2.flags[MOD]) === "{}" && api.zoneOfToken(t2).spot === "z2", "back to the ground: no flags left");
take();
const t5 = makeToken(sc, "t5", 250, 0); sc.tokens.push(t5); Hooks.callAll("createToken", t5, {}, "gm");
ev = take();
check(ev.length === 1 && ev[0].type === "tokenEntered" && ev[0].from === null && ev[0].to.zone === "z2" && ev[0].cause === "create", "a new token enters");
sc.tokens.splice(sc.tokens.indexOf(t5), 1); Hooks.callAll("deleteToken", t5, {}, "gm");
ev = take();
check(ev.length === 1 && ev[0].type === "tokenLeft" && ev[0].to === null && ev[0].from.zone === "z2" && ev[0].cause === "delete", "a deleted token leaves");

/* ---- the GM check comes first (setZone / clearStates used to touch the fire layer before it) */
moduleApi.fire.remove = () => { removed++; };
game.user.isGM = false;
check(api.setZone(0, { fire: 8 }) === false && painted === 0 && api.clearStates() === false && api.marks().zones.get(0) === undefined && take().length === 0, "a player's setZone / clearStates: refused before anything is painted or put out");
game.user.isGM = true;

/* ---- zone and border state events; keys written down by the first edit */
check(api.setZone(0, { fire: 8, empty: true, tags: ["metal"] }) === true && painted === 1, "the GM's setZone: written, the fire painted");
ev = take();
check(ev.length === 1 && ev[0].type === "zoneChanged" && ev[0].zone === "z1" && ev[0].id === 0 && J(ev[0].before) === "{}" && ev[0].after.fire === 8 && ev[0].changed.sort().join() === "empty,fire,tags" && ev[0].source === "edit" && !ev[0].added, `zoneChanged: ${J(ev[0]?.changed)}`);
check(api.zone("z1").empty && J(api.zone("z1").tags) === J(["metal"]) && api.zone("z1").states.fire === 8, "the new attributes are stored and read back");
check(J(api.state().k.map((a) => a[0])) === J(["z1", "z2", "z3", "z4"]) && api.state().kn === 5 && J(api.keys()) === J(["z1", "z2", "z3", "z4"]), "the first edit writes the keys down, unchanged");
check(api.version() > v0, "the version moved");
api.setBorder(400, 100, "locked");
ev = take();
check(ev.length === 1 && ev[0].type === "borderChanged" && ev[0].border === "z2|z3" && ev[0].before === "open" && ev[0].after === "locked" && J(ev[0].zones.slice().sort()) === J(["z2", "z3"]), "borderChanged");
check(api.clearStates(0) === true && take().some((e) => e.type === "zoneChanged" && e.changed.join() === "fire" && e.after.empty === true), "clearStates: the state goes, the attributes stay");

// a new line cuts zone z3 (400..600) at 480: zones are renumbered, keys stay, the tokens there are told nothing they did not do
await t4.update({ x: 540 }); take();                                      // t4's centre is at 590, in z3
const before = api.keys().join();
api.addStroke([480, -20, 480, 220]);
ev = take();
const kAt = (x) => api.placeAt(x, 100).zone;
check(api.zones().zones.length === 5 && [100, 300, 440, 550, 700].map(kAt).join() === "z1,z2,z5,z3,z4", `a cut: keys ${[100, 300, 440, 550, 700].map(kAt)} (were ${before}), ids ${[100, 300, 440, 550, 700].map((x) => api.zoneAt(x, 100))}`);
check(ev.some((e) => e.type === "zoneChanged" && e.added && e.zone === "z5") && ev.some((e) => e.type === "borderChanged" && e.border === "z3|z5" && e.before === null && e.after === "open") && !ev.some((e) => e.type.startsWith("token")), "the cut is told: a new zone, a new border; nobody moved");
check(ev.some((e) => e.type === "borderChanged" && e.border === "z2|z5" && e.after === "locked") && ev.some((e) => e.type === "borderChanged" && e.border === "z2|z3" && e.after === null), "the locked door now belongs to the border z2|z5; z2|z3 is gone");
check(api.zoneOfToken(t4).zone === "z3" && api.borderBetween("z1", "z2").kind === "outer" && api.zone("z2").floors === 2, "marks and tokens keep to their zones by key");
api.undo();
check(api.keys().join() === before && api.zones().zones.length === 4, "undo: the keys as before");
api.redo();
check([100, 300, 440, 550, 700].map(kAt).join() === "z1,z2,z5,z3,z4", "redo: the same new key again");
// the eraser takes the line 400 away: z5 (400..480) joins z2 - the older key names the zone; a token that stood in z5 is told
const t6 = makeToken(sc, "t6", 390, 0); sc.tokens.push(t6); Hooks.callAll("createToken", t6, {}, "gm"); take();
check(api.zoneOfToken(t6).zone === "z5", "a token in z5");
api.erase([400, -20, 400, 220], 4);
ev = take();
check(kAt(440) === "z2" && api.idOf("z5") === -1 && ev.some((e) => e.type === "zoneChanged" && e.removed && e.zone === "z5") && ev.some((e) => e.type === "tokenEntered" && e.token === "t6" && e.from.zone === "z5" && e.to.zone === "z2" && e.cause === "zones"), "a join: z5 is gone, its token is told it is in z2 now (cause: zones)");

/* ---- what is saved, and what another client makes of it */
await Zones.save();
const saved = sc.flags[MOD].zones;
check(Array.isArray(saved.k) && saved.kn === 6 && saved.k.some((a) => a[0] === "z5"), "the keys are saved with the scene (the joined-away one sleeps)");
const keysGM = api.keys().join(), spotsGM = sc.tokens.map((t) => api.zoneOfToken(t).spot).join();
game.user = { isGM: false, id: "player" };
open(makeScene(JSON.parse(J(saved)), sc.tokens.map((t) => [t.id, t.x, t.y, t.flags[MOD]])));
check(api.keys().join() === keysGM && scene.tokens.map((t) => api.zoneOfToken(t).spot).join() === spotsGM && take().length === 0, "a player's client reads the same keys and places from the flag");
// the GM changes the flag: the player's client hears it through updateScene
const f2 = JSON.parse(J(saved)); f2.m.push([700, 100, { dark: true }]);
scene.flags[MOD].zones = f2;
Hooks.callAll("updateScene", scene, { flags: { [MOD]: { zones: f2 } } }, {}, "gm");
ev = take();
check(ev.length === 1 && ev[0].type === "zoneChanged" && ev[0].zone === "z4" && ev[0].source === "sync" && ev[0].after.dark === true, "a change made by another client is told here too (source: sync)");
check(api.setLevel(scene.tokens[0], { level: "elevated" }) instanceof Promise && api.addStroke([10, 10, 50, 50]) === false, "a player may set the level of a token it owns, not edit the zones");

console.log(failed ? `${failed} failed` : "all zones api checks passed");
process.exit(failed ? 1 : 0);
