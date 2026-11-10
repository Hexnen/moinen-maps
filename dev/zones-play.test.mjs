// Zones, package M2, wired through scripts/zones/zones.mjs with a stand-in Foundry (no canvas, no PIXI): border states and
// rebuilding, the zone-state registry, temporary edges, apply() with inverses, events, what a second client reads, the editor's
// undo leaving play state alone, movement (cost, reach, plans, forced chains, free spots, step-by-step moves with listeners,
// groups) and the cost confirmation on a dragged token.   node dev/zones-play.test.mjs
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
  callAll(name, ...args) { for ( const fn of [...(hooks.get(name) ?? [])] ) fn(...args); return true; },
  call(name, ...args) { for ( const fn of [...(hooks.get(name) ?? [])] ) if ( fn(...args) === false ) return false; return true; }
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
const warned = [];
globalThis.ui = { notifications: { info() {}, warn: (m) => warned.push(m) } };
globalThis.game = {
  user: { isGM: true, id: "gm" },
  users: { activeGM: { id: "gm" } },
  i18n: { lang: "en", localize: (k) => k, format: (k) => k, has: () => false },
  settings: { register: (m, k, o) => settings.set(k, o.default), get: (m, k) => { if ( !settings.has(k) ) throw new Error(`no setting ${k}`); return settings.get(k); } },
  scenes: { get: () => scene },
  modules: { get: () => ({}) }
};

const expand = (flat) => { const o = {}; for ( const [k, v] of Object.entries(flat) ) { const ps = k.split("."); let t = o; ps.slice(0, -1).forEach((p) => { t = t[p] ??= {}; }); t[ps.at(-1)] = v; } return o; };
const applyFlags = (flags, ch) => { for ( const [k, v] of Object.entries(ch ?? {}) ) { if ( k.startsWith("-=") ) delete flags[k.slice(2)]; else flags[k] = v; } };
let scene = null;
const writes = [];                                                   // every token write: { ids, options }
function makeScene(flag, tokens = []) {
  const s = { id: "scene1", flags: { [MOD]: flag ? { zones: flag } : {} }, saves: 0 };
  s.update = async (data) => { s.saves++; for ( const [k, v] of Object.entries(data) ) if ( k === `flags.${MOD}.zones` ) s.flags[MOD].zones = JSON.parse(JSON.stringify(v)); return s; };
  s.tokens = tokens.map(([id, x, y, fl, size]) => makeToken(s, id, x, y, fl, size));
  s.updateEmbeddedDocuments = async (type, updates, options = {}) => {
    writes.push({ ids: updates.map((u) => u._id), options });
    for ( const u of updates ) { const { _id, ...flat } = u; await s.tokens.find((t) => t.id === _id).update(flat, options); }
    return updates;
  };
  return s;
}
function makeToken(s, id, x, y, fl = {}, size = 1) {
  const d = { id, name: id, uuid: `Scene.${s.id}.Token.${id}`, x, y, width: size, height: size, actorId: `actor-${id}`, isOwner: true, parent: s, documentName: "Token", flags: { [MOD]: { ...fl } }, object: null };
  d.getFlag = (m, k) => d.flags[m]?.[k];
  d.update = async (flat, options = {}) => {
    const ch = expand(flat);
    if ( Hooks.call("preUpdateToken", d, ch, options, game.user.id) === false ) return undefined;
    for ( const k of ["x", "y"] ) if ( k in ch ) d[k] = ch[k];
    applyFlags(d.flags[MOD], ch.flags?.[MOD]);
    Hooks.callAll("updateToken", d, ch, options, game.user.id);
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
    scene: s, ready: true, dimensions: { size: 100, width: 1000, height: 400, sceneRect: { x: 0, y: 0, width: 1000, height: 200 } }, grid: { size: 100 },
    app: { view: { addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) }, ticker: { add() {}, remove() {} }, renderer: any },
    tokens: { controlled: [], placeables: [] }, stage: { scale: { x: 1 } }
  }, { get: (t, k) => (k in t ? t[k] : any) });
  Hooks.callAll("canvasReady");
}

const Zones = await imp("scripts/zones/zones.mjs");
const { api: moduleApi } = await imp("scripts/attrs.mjs");
let painted = 0, putOut = 0;
moduleApi.fire = { paint: () => { painted++; return "f1"; }, remove: () => { putOut++; } };
Zones.registerZones();
Hooks.callAll("init");
const api = Zones.zonesApi;
const events = [];
Hooks.on(api.EVENT_HOOK, (type, payload) => events.push({ type, ...payload }));
const take = () => events.splice(0);

// five zones in a row (dividers at 200, 400, 600, 800 in the 1000 x 200 scene), stored the way an old scene stores them: one kind
// per border - a wall z1|z2, a locked door z2|z3, an exterior wall z3|z4, z4|z5 open; z3 is a building with two floors
const oldFlag = {
  v: 1, s: [[1, [200, -20, 200, 220]], [2, [400, -20, 400, 220]], [3, [600, -20, 600, 220]], [4, [800, -20, 800, 220]]], next: 5, preset: null, snap: 0.25, smooth: 0,
  look: { who: "none" }, w: [[200, 100, "wall"], [400, 100, "locked"], [600, 100, "outer"]], m: [[500, 100, { building: true, floors: 2 }]]
};
const sc = makeScene(JSON.parse(J(oldFlag)), [["t1", 0, 0], ["t2", 100, 0], ["t3", 200, 0], ["t4", 800, 100, { alt: "elevated" }]]);
open(sc);
const [t1, t2, t3, t4] = sc.tokens;

/* ---- an old scene reads as walls and doors without a write */
let b = api.borderBetween("z2", "z3");
check(sc.saves === 0 && b.kind === "locked" && b.armor === 2 && b.door === true && b.wall.armor === 2 && b.wall.state === "intact" && b.doorway.state === "locked" && b.doorway.armor === 2 && b.base === "locked", "an old locked-door mark: a wall with a locked door, each with its Armor; nothing written");
check(api.borderBetween("z1", "z2").doorway === null && api.borderBetween("z3", "z4").wall.outer === true && api.borderBetween("z4", "z5").wall === null && api.borderBetween("z4", "z5").kind === "open", "a wall has no door; an exterior wall; an open border has no wall");
check(!("bs" in api.state()) && !("q" in api.state()) && !("e" in api.state()) && !("pn" in api.state()) && J(api.state().w) === J(oldFlag.w), "the flag of an untouched scene has no new fields");
let g = api.graph();
check(g.zones.length === 5 && g.zones[2].rooftop === true && g.borders.length === 4 && J(g.borders.find((x) => x.id === "z2|z3")) === J({ id: "z2|z3", a: "z2", b: "z3", wall: { armor: 2, state: "intact" }, door: { armor: 2, state: "locked" } }) && J(g.borders.find((x) => x.id === "z4|z5").wall) === "null" && api.graph() === g, "graph(): the shape the combat rules take, kept until something changes");

/* ---- only the active GM's client writes */
game.user.isGM = false;
let r = await api.setBorderState("z2|z3", { door: { state: "open" } });
check(r.ok === false && r.reason === "notGM" && api.canWrite() === false, "a player's write is refused");
game.user.isGM = true; game.users.activeGM = { id: "other" };
r = await api.apply({ op: "border", border: "z2|z3", door: { state: "open" } });
check(r.ok === false && r.reason === "notActiveGM", "a GM who is not the active one is refused too");
game.users.activeGM = { id: "gm" };
check(take().length === 0 && sc.saves === 0, "a refused write changes and tells nothing");

/* ---- border states, each write with its inverse */
const v0 = api.version();
r = await api.setBorderState("z2|z3", { door: { state: "open" } });
let ev = take();
check(r.ok && r.changed && J(r.inverse) === J({ op: "border", border: "z2|z3", play: null }) && r.result.kind === "door" && r.result.doorway.state === "open" && r.result.doorway.built === "locked" && !r.result.stops.walk, "the locked door is opened: passable, the inverse puts it back as built");
check(ev.length === 1 && ev[0].type === "borderChanged" && ev[0].border === "z2|z3" && ev[0].before === "locked" && ev[0].after === "door" && ev[0].was.door.state === "locked" && ev[0].now.door.state === "open" && ev[0].source === "play", "borderChanged: what it amounts to, and its wall and door before and after (source: play)");
check(sc.saves === 1 && J(sc.flags[MOD].zones.bs) === J([[400, 100, { d: "open" }]]) && J(sc.flags[MOD].zones.w) === J(oldFlag.w) && Array.isArray(sc.flags[MOD].zones.k), "saved at once: the play record beside the wall as built; the keys written down");
check(api.version() > v0 && api.route("z2", "z3", "walk").total === 1 && api.graph() !== g && api.graph().borders.find((x) => x.id === "z2|z3").door.state === "open", "the routes and the graph follow");
r = await api.setBorderState("z2|z3", { door: { state: "sealed" } });
ev = take();
const invSealed = r.inverse;
check(r.ok && J(invSealed.play) === J({ d: "open" }) && ev.length === 1 && ev[0].before === "door" && ev[0].after === "locked" && api.route("z2", "z3", "walk") === null, "sealed electronically: it stops again; the inverse remembers it was open");
r = await api.setBorderState("z1|z2", { wall: { state: "breached" } });
const invBreach = r.inverse;
check(r.ok && r.result.kind === "open" && r.result.armor === 0 && r.result.wall.state === "breached" && r.result.wall.armor === 2 && api.route("z1", "z2", "walk").total === 1 && take()[0].after === "open", "a breached wall: open to walk through, still a wall with its Armor in the data");
r = await api.setBorderState("z3|z4", { wall: { state: "removed", temp: true } });
check(r.ok && r.result.wall.temp === true && r.result.wall.state === "removed" && J(sc.flags[MOD].zones.bs.find((p) => p[0] === 600)[2]) === J({ w: "removed", t: 1 }), "a wall removed for a while says so");
take();
r = await api.setBorderState("z1|z2", { door: { state: "open" } });
check(r.ok === false && r.reason === "noDoor" && (await api.setBorderState("z4|z5", { wall: { state: "breached" } })).reason === "noWall" && (await api.setBorderState("z1|z3", {})).reason === "noBorder" && (await api.setBorderState("z1|z2", { wall: { state: "dust" } })).reason === "wallState" && take().length === 0, "what cannot be is refused with a reason: no door, no wall, no such border, an unknown state");
r = await api.setBorderState("z1|z2", { wall: { state: "breached" } });
check(r.ok && r.changed === false && take().length === 0, "the same state again: nothing changes, nothing is told");
// inverses, last first
r = await api.apply(invBreach);
check(r.ok && api.borderBetween("z1", "z2").wall.state === "intact" && api.route("z1", "z2", "walk") === null && J(r.inverse.play) === J({ w: "breached" }), "the inverse of the breach: the wall stands (and its own inverse breaches it again)");
r = await api.apply(invSealed);
check(r.ok && api.borderBetween("z2", "z3").doorway.state === "open", "the inverse of the sealing: open, as it was before that write");
take();

/* ---- restoring is a GM action; nothing restores on its own */
check(Zones.bordersChanged() === true && api.clearStates() === false && api.borderBetween("z2", "z3").doorway.state === "open" && api.borderBetween("z3", "z4").wall.state === "removed", "the end-of-scene clearing of zone states leaves the borders as they are");
r = await api.restoreBorders("z3|z4");
check(r.ok && api.borderBetween("z3", "z4").wall.state === "intact" && J(r.inverse.play) === J({ w: "removed", t: 1 }), "one border restored (with an inverse)");
r = await api.restoreBorders();
ev = take();
check(r.ok && Zones.bordersChanged() === false && api.borderBetween("z2", "z3").doorway.state === "locked" && !("bs" in api.state()) && r.inverse.op === "batch" && ev.filter((e) => e.type === "borderChanged").length === 2, "every border restored: as built, no play records left");
r = await api.apply(r.inverse);
check(r.ok && api.borderBetween("z2", "z3").doorway.state === "open" && Zones.bordersChanged(), "... and the restoring itself can be taken back");
await api.restoreBorders(); take();

/* ---- building a border anew (a wall raised, a door put in, Armor changed) */
r = await api.buildBorder("z4|z5", { kind: "reinforced", wall: { armor: 5 }, door: { state: "sealed" } });
const invBuild = r.inverse;
check(r.ok && r.result.wall.armor === 5 && r.result.doorway.armor === 5 && r.result.doorway.state === "sealed" && r.result.kind === "locked" && J(invBuild) === J({ op: "borderBuild", border: "z4|z5", raw: null, play: null }), "a reinforced wall with a sealed door where the border was open");
check(J(api.state().w.at(-1).slice(2)) === J(["reinforced", { wall: { armor: 5 }, door: { state: "sealed" } }]), "stored as its kind and what differs from it");
r = await api.buildBorder("z4|z5", { door: null });
check(r.ok && r.result.doorway === null && r.result.kind === "reinforced" && r.result.armor === 5, "the door taken out: the wall stays as it was");
r = await api.buildBorder("z2|z3", { wall: { armor: 3 } });
check(r.ok && r.result.wall.armor === 3 && r.result.doorway.state === "locked" && r.result.doorway.armor === 2 && r.result.base === "locked", "the Armor of a wall changed: its door is untouched");
await api.apply(r.inverse);
check(api.borderBetween("z2", "z3").wall.armor === 2 && J(api.state().w.find((w) => w[0] === 400)) === J([400, 100, "locked"]), "... and back: the old three-value mark again");
await api.setBorderState("z4|z5", { wall: { state: "breached" } });
r = await api.buildBorder("z4|z5", { wall: null });
check(r.ok && api.borderBetween("z4", "z5").wall === null && J(r.inverse.play) === J({ w: "breached" }) && r.inverse.raw[0] === "reinforced", "a wall taken away altogether: its inverse knows how it was built and that it was breached");
await api.apply(r.inverse);
check(api.borderBetween("z4", "z5").wall.state === "breached" && api.borderBetween("z4", "z5").wall.armor === 5, "... put back exactly");
await api.apply(invBuild);
check(api.borderBetween("z4", "z5").kind === "open" && (await api.buildBorder("z4|z5", { kind: "moat" })).reason === "badBorder", "the first inverse: open again; an unknown kind is refused");
// the GM's menu marks a border anew: as built, the play record of the old one goes
await api.setBorderState("z2|z3", { door: { state: "open" } });
api.setBorder(400, 100, "wall");
check(api.borderBetween("z2", "z3").doorway === null && !("bs" in api.state()), "the GM's menu marks a border anew: what happened to the old one in play goes with it");
api.setBorder(400, 100, "locked"); take();
check(api.borderAt(400, 100).kind === "locked" && api.borderAt(400, 100).now === "locked" && api.borderAt(400, 100).door.state === "locked", "borderAt: the kind as built (for the menu), what it amounts to now, its wall and door");

/* ---- the zone-state registry */
r = await api.addZoneState("z1", { kind: "dark", owner: { combatant: "c7" }, ends: { when: "ownerBroken" }, except: ["c7"], junk: 1 });
ev = take();
const dark = r.result;
check(r.ok && dark.id === "s1" && dark.kind === "dark" && dark.zone === "z1" && J(dark.owner) === J({ combatant: "c7" }) && J(dark.except) === J(["c7"]) && dark.junk === undefined && J(r.inverse) === J({ op: "zoneState.remove", id: "s1" }), "darkness in z1: owner, end condition, exemptions stored; an id; the inverse removes it");
check(ev.length === 1 && ev[0].type === "zoneChanged" && ev[0].zone === "z1" && ev[0].changed.sort().join() === "dark,states" && ev[0].after.dark === true && ev[0].statesAfter.length === 1 && ev[0].statesBefore.length === 0 && ev[0].source === "play", "zoneChanged: the property the map draws and the registry's records");
check(api.zone("z1").states.dark === true && api.zone("z1").records.length === 1 && api.zone("z1").records[0].source === "registry" && api.ownMarks().zones.get(0) === undefined, "the zone reads as dark (icons, older API); the GM's own marks are untouched");
r = await api.addZoneState("z2", { kind: "smoke", level: 2 });
check(r.ok && r.result.id === "s2" && api.zone("z2").states.dark === false && J(api.marks().zones.get(1) ?? {}) === "{}" && take()[0].changed.join() === "states", "smoke is stored and told, not drawn: no zone property");
r = await api.addZoneState("z2:elevated", { kind: "gravity", data: { mode: "low" }, owner: "c2" });
check(r.ok && r.result.at === "elevated" && api.zone("z2").states.lowgrav === true, "a state on a level (a spot string names it); low gravity reads as the map's low-gravity mark");
check(api.zoneStates("z2").map((s) => s.id).join() === "s2,s3" && api.zoneStates("z2:elevated").map((s) => s.id).join() === "s2,s3" && api.zoneStates(api.place("z2")).map((s) => s.id).join() === "s2" && api.zoneStates(t3).map((s) => s.id).join() === "s2" && api.zoneStates(t4).length === 0, "zoneStates: a bare key every level; a place that level and the states that name none; a token its own zone");
check(api.zoneStates().length === 3 && api.zoneStates().every((s) => s.zone) && api.zoneState("s3").zone === "z2" && api.zoneState("nope") === null, "every registry state of the scene; one by id");
r = await api.addZoneState("z3", { kind: "fire", level: 8, owner: "c1" });
check(r.ok && api.zone("z3").states.fire === 8 && painted === 0, "a fire in the registry reads as Intensity 8; nothing is painted on the fire layer for it");
api.setZone(2, { fire: 9 });
check(api.zone("z3").states.fire === 9 && api.zoneStates("z3").map((s) => `${s.source}:${s.kind}:${s.level}`).join() === "registry:fire:8,mark:fire:9" && painted === 0, "the GM marks a fire too: the higher Intensity shows, both are listed with where they come from (the zone was burning already: nothing new is painted)");
api.setZone(2, { fire: 0 }); take();
r = await api.updateZoneState("s4", { level: 5, ends: "round 3", except: null });
check(r.ok && api.zone("z3").states.fire === 5 && r.result.ends === "round 3" && J(r.inverse.patch) === J({ level: 8, ends: null, except: null }), "a state changed: its level and end; the inverse holds what they were");
await api.apply(r.inverse);
check(api.zoneState("s4").level === 8 && api.zoneState("s4").ends === undefined, "... and back");
r = await api.removeZoneState("s4");
const invRemove = r.inverse;
check(r.ok && api.zone("z3").states.fire === 0 && api.zoneState("s4") === null && invRemove.op === "zoneState.add" && invRemove.state.id === "s4", "a state removed; the inverse puts the same record back");
r = await api.apply(invRemove);
check(r.ok && api.zoneState("s4").owner === "c1" && api.zone("z3").states.fire === 8 && (await api.apply(invRemove)).reason === "idTaken", "... under the same id, once");
r = await api.addZoneState("z5", { kind: "weather", data: { type: "storm" } });
check(r.result.id === "s5" && api.state().pn === 6, "ids are never used twice: the counter went on past the removed and restored one");
check((await api.addZoneState("zz", { kind: "dark" })).reason === "noZone" && (await api.addZoneState("z1", { kind: "Not A Kind" })).reason === "badState" && (await api.addZoneState("z1", { kind: "x", data: "y".repeat(5000) })).reason === "badState" && (await api.removeZoneState("s99")).reason === "noState", "bad states are refused with a reason");
take();
// wrecking through the registry: the zone reads as wrecked everywhere (rooftop gone, wreck data)
r = await api.addZoneState("z3", { kind: "wrecked", owner: "c1" });
check(api.zone("z3").states.wrecked && api.zone("z3").rooftop === false && api.zone("z3").wreck.why === "wrecked" && api.graph().zones[2].wrecked === true, "a zone wrecked through the registry is wrecked for every reader");
await api.apply(r.inverse);
check(api.zone("z3").rooftop === true, "... and whole again by the inverse (the GM's or the journal's call, never automatic)");
take();

/* ---- a batch: all or nothing, told and saved once */
const saves0 = sc.saves;
r = await api.apply({ op: "batch", ops: [{ op: "border", border: "z1|z2", wall: { state: "breached" } }, { op: "zoneState.add", zone: "z4", state: { kind: "toxic" } }, { op: "zone", zone: "z4", patch: { tags: ["metal"], empty: true } }] });
ev = take();
check(r.ok && r.inverse.op === "batch" && r.inverse.ops.length === 3 && r.inverse.ops[0].op === "zone" && sc.saves === saves0 + 1 && ev.filter((e) => e.type === "borderChanged").length === 1 && ev.filter((e) => e.type === "zoneChanged").length === 1, "a batch: three writes, one save, each change told once; the inverse undoes them last first");
check(api.zone("z4").empty && api.zone("z4").tags.includes("metal") && api.zoneStates("z4").some((s) => s.kind === "toxic"), "... all written");
r = await api.apply(r.inverse);
check(r.ok && !api.zone("z4").empty && api.zone("z4").tags.length === 0 && api.zoneStates("z4").length === 0 && api.borderBetween("z1", "z2").wall.state === "intact", "the batch taken back");
take();
const snap = J(api.state());
r = await api.apply({ op: "batch", ops: [{ op: "border", border: "z1|z2", wall: { state: "breached" } }, { op: "zoneState.remove", id: "nope" }] });
check(r.ok === false && r.reason === "noState" && r.at === 1 && J(api.state()) === snap && take().length === 0, "a batch that fails half way leaves nothing behind and tells nothing");
check((await api.apply({ op: "dance" })).reason === "badOp" && (await api.apply(null)).reason === "badOp", "an unknown op is refused");
// a zone's own marks through apply(): as setZone, with the fire it paints, and an inverse
r = await api.apply({ op: "zone", zone: "z5", patch: { fire: 7 } });
check(r.ok && painted === 1 && api.zone("z5").states.fire === 7 && J(r.inverse.patch) === J({ fire: null }) && api.ownMarks().zones.get(4).fire === 7, "a zone's own mark through apply(): written as the GM's mark, the fire painted");
await api.apply(r.inverse);
check(api.zone("z5").states.fire === 0 && api.ownMarks().zones.get(4) === undefined, "... and put out by the inverse");
take();

/* ---- temporary edges */
r = await api.addEdge({ kind: "portal", a: "z1", b: "z5:elevated", owner: "c3", ends: "few minutes", data: { size: "human" } });
ev = take();
check(r.ok && r.result.id === `e${api.state().pn - 1}` && r.result.live === true && r.result.b === "z5:elevated" && ev.length === 1 && ev[0].type === "edgeChanged" && ev[0].before === null && ev[0].after.kind === "portal" && J(r.inverse) === J({ op: "edge.remove", id: r.result.id }), "a portal between distant zones: stored, told (edgeChanged), with an inverse");
r = await api.addEdge({ kind: "tunnel", a: t1, b: "z2", ways: ["walk", "through"] });
check(r.ok && r.result.a === "z1" && api.edges().length === 2 && api.edgesOf("z1").length === 2 && api.edgesOf("z3").length === 0 && api.graph().edges.length === 2, "a tunnel under the wall z1|z2 (an end may be a token: where it stands); edges() / edgesOf() / graph().edges");
check(api.route("z1", "z2", "walk") === null && api.range("z1", "z5").total === 4 && api.plan("z1", "z2").steps[0].kind === "edge" && api.plan("z1", "z5").total === 1 && api.plan("z1", "z2", { way: "walk", edges: false }) === null, "route() and range() do not know edges; plan() takes them (and can be told not to)");
check((await api.addEdge({ kind: "portal", a: "z1", b: "zz" })).reason === "noZone" && (await api.addEdge({ kind: "portal", a: "z1", b: "z1" })).reason === "badEdge" && (await api.removeEdge("e99")).reason === "noEdge", "bad edges are refused");
r = await api.addEdge({ kind: "portal", a: "z3", b: "@dimension" });
check(r.ok && r.result.live === false && api.graph().edges.length === 2, "a portal to another dimension is stored and listed, and joins nothing on the map");
await api.apply(r.inverse);
take();

/* ---- the editor's undo leaves play state alone; a redrawn map keeps it by key and by point */
await api.setBorderState("z2|z3", { door: { state: "open" } }); take();
api.addStroke([100, -20, 100, 220]);                                 // cuts z1 in two: z1 (0..100) keeps its key, the new half borders z2
check(api.zones().zones.length === 6 && api.zoneState("s1").zone === api.placeAt(150, 100).zone && api.borderBetween("z2", "z3").doorway.state === "open", "a line drawn through z1: the darkness stays with the half its point lies in, the opened door stays open");
check(api.edges().find((e) => e.kind === "tunnel").live === false || api.plan("z1", "z2")?.steps.some((s) => s.kind === "edge"), "the tunnel still names z1 and z2 by key");
api.undo();
check(api.zones().zones.length === 5 && api.zoneStates().length === 5 && api.borderBetween("z2", "z3").doorway.state === "open" && api.edges().length === 2, "undo of the line: the play state is as it was a moment ago, not as it was before the line");
await api.removeZoneState("s2");
api.redo(); api.undo();
check(api.zoneState("s2") === null && api.zones().zones.length === 5, "redo and undo never bring a removed state back");
take();

/* ---- another client reads the same from the flag */
await Zones.save();
const saved = JSON.parse(J(sc.flags[MOD].zones));
const gmView = J([api.zoneStates(), api.edges(), api.graph(), api.zoneList().map((z) => z.states)]);
game.user = { isGM: false, id: "player" };
open(makeScene(saved, sc.tokens.map((t) => [t.id, t.x, t.y, t.flags[MOD]])));
check(J([api.zoneStates(), api.edges(), api.graph(), api.zoneList().map((z) => z.states)]) === gmView && take().length === 0, "a player's client reads the same borders, states, edges and graph");
const f2 = JSON.parse(J(saved)); f2.bs = [...(f2.bs ?? []), [200, 100, { w: "breached" }]]; f2.q = f2.q.filter((q) => q[2].id !== "s1");
scene.flags[MOD].zones = f2;
Hooks.callAll("updateScene", scene, { flags: { [MOD]: { zones: f2 } } }, {}, "gm");
ev = take();
check(ev.some((e) => e.type === "borderChanged" && e.border === "z1|z2" && e.after === "open" && e.source === "sync") && ev.some((e) => e.type === "zoneChanged" && e.zone === "z1" && e.changed.includes("states") && e.source === "sync"), "a change by the GM's client arrives as events here (source: sync)");
check((await api.addZoneState("z1", { kind: "dark" })).reason === "notGM", "and a player still cannot write");

/* ---- movement: back on the GM's client, on a fresh copy of the old scene */
game.user = { isGM: true, id: "gm" };
const sm = makeScene(JSON.parse(J(oldFlag)), [["t1", 0, 0], ["t2", 100, 0], ["t3", 200, 0], ["t4", 800, 100, { alt: "elevated" }], ["big", 800, 0, {}, 1]]);
open(sm); take(); writes.length = 0;
const [m1, m2, m3, m4] = sm.tokens;
// cost and reach from a profile
check(api.profile({ way: "flight", speed: 2, stress: true }).stressSpeed === 4 && api.profile({ way: "hop" }) === null, "profile(): filled in, or null for an unknown way");
let mc = api.moveCost(m3, "z3", { way: "walk" });
check(mc.reachable === false && mc.cost === null && api.moveCost(m3, "z3", { way: "flight", speed: 2 }).reachable === false && api.moveCost(m3, "z4", { way: "burrow", speed: 2, stress: true }).cost.within === "plain", "moveCost: the locked door stops a walker and a flyer; burrowing two zones is one action");
mc = api.moveCost(m3, "z5", { way: "teleport", speed: 2, stress: true });
check(mc.cost.total === 3 && mc.cost.actions === 2 && mc.cost.stressActions === 1 && mc.cost.within === "stress", "three zones with a 2 / 4 power: one action only with stress");
check(api.reach(m1, {}).map((x) => x.zone).join() === "z1" && api.reach("z4", { way: "walk" }, { max: 1 }).map((x) => x.zone).join() === "z4,z5" && api.reach(m1, { way: "burrow", speed: 2 }).find((x) => x.zone === "z3").cost.within === "plain", "reach(): walled in on foot; capped; by a power");
// a forced chain: away from the attacker, three zones, the barriers in order
let fc = api.forcedChain(m3, { awayFrom: m2, distance: 3 });
check(fc.forced && fc.zones.join() === "z2,z3,z4,z5" && fc.steps.map((s) => !!s.border.blocked).join() === "true,true,false" && fc.steps[0].border.doorway.armor === 2 && fc.steps[1].border.wall.armor === 3 && fc.ray.end === "distance" && fc.ray.dx === 1 && fc.ray.dy === 0, "forcedChain away from the attacker: the zones in order, the locked door and the exterior wall marked blocked with their Armor");
check(api.forcedChain(m3, { direction: { angle: 180 }, distance: 5 }).zones.join() === "z2,z1" && api.forcedChain(m3, { direction: { angle: 180 }, distance: 5 }).ray.end === "edge" && api.forcedChain(m3, { toward: "z5", distance: 1 }).zones.join() === "z2,z3" && api.forcedChain(m3, { awayFrom: m3 }) === null && api.forcedChain(m3, {}) === null, "by an angle (to the map's edge), toward a place; no direction: null");
fc = api.forcedChain(m4, { direction: { dx: -1, dy: 0 }, distance: 2 });
check(fc.way === "air" && fc.steps.every((s) => s.level === "elevated") && fc.steps[1].border.over === true && !fc.steps[1].border.blocked && fc.end.airborne === true, "an elevated target thrown west stays at rooftop height: it passes over the exterior wall, and ends in the air");
let ed = api.planAlong(m3, ["z2", "z1"], { forced: true });
check(ed.forced && ed.zones.join() === "z2,z1" && ed.steps[0].border.blocked === true && api.planAlong(m3, ["z2", "z4"]) === null && api.planAlong(m3, ["z1", "z2"]) === null, "a chain the GM edited is laid out the same way; one that does not hang together is refused");
// free spots
let sp = api.freeSpot("z1", { token: m3 });
check(sp && !sp.crowded && api.zoneAt(sp.x + 50, sp.y + 50) === 0 && !(sp.x === 0 && sp.y === 0) && !(sp.x === 100 && sp.y === 0), `a free spot in z1 clear of the two tokens there: ${sp.x},${sp.y}`);
check(api.freeSpot("z1", { token: m1 }).crowded === false && api.freeSpot("zz") === null, "the token itself is not in its own way");

/* ---- move(): step by step, the listeners asked before every step */
const asked = [];
let answer = () => undefined;
const off = api.beforeStep(async (ctx) => { asked.push(ctx); await new Promise((res) => setTimeout(res, 2)); return answer(ctx); });
let mv = await api.move(m3, "z3", { profile: { way: "walk" } });
check(mv.ok === false && mv.reason === "noRoute" && asked.length === 0, "no route for a walker: nothing happens, nobody is asked");
// a crash through the locked door: the listener breaches it, the move goes on
answer = async (ctx) => { if ( ctx.border?.stops.walk ) await api.setBorderState(ctx.border.key, ctx.border.doorway ? { door: { state: "breached" } } : { wall: { state: "breached" } }); };
mv = await api.move(m3, "z3", { profile: { way: "walk", force: true }, data: { action: "a1" } });
ev = take();
check(mv.ok && mv.done === 1 && mv.stopped === null && api.zoneOfToken(m3).zone === "z3" && api.borderBetween("z2", "z3").doorway.state === "breached", "a mover that may crash through: the listener breaches the door before the step, the step is taken");
check(asked.length === 1 && asked[0].index === 0 && asked[0].last && asked[0].token === m3 && asked[0].from.zone === "z2" && asked[0].to.zone === "z3" && asked[0].border.key === "z2|z3" && asked[0].border.doorway.state === "locked" && asked[0].data.action === "a1" && asked[0].profile.force && asked[0].op === mv.op && Array.isArray(asked[0].statesTo), "what the listener gets: the step, the places, the border as it is, the profile, the caller's data");
check(ev.map((e) => e.type).join() === "moveStarted,borderChanged,tokenLeft,tokenEntered,moveStep,moveEnded" && ev[3].move === mv.op && ev[3].cause === "move" && ev[5].done === 1, `the events of a move: ${ev.map((e) => e.type)}`);
check(mv.inverse.op === "tokens" && J(mv.inverse.rows) === J([{ id: "t3", x: 200, y: 0, alt: null, floor: null, air: null }]) && writes.at(-1).options.mmMove === mv.op, "the inverse puts the token back where it started; the token write carries the move's id");
r = await api.apply(mv.inverse);
check(r.ok && m3.x === 200 && m3.y === 0 && api.zoneOfToken(m3).zone === "z2" && r.inverse.op === "tokens", "... and does");
take(); asked.length = 0;
// a listener stops the move before the second step (a roll that failed)
answer = (ctx) => (ctx.to.zone === "z4" ? { stop: true, reason: "agilityFailed", data: { sixes: 0 } } : undefined);
await api.setBorderState("z3|z4", { wall: { state: "breached" } });
mv = await api.move(m3, "z5", { profile: { way: "walk", speed: 4 } });
check(mv.ok && mv.done === 1 && mv.total === 3 && mv.stopped.index === 1 && mv.stopped.reason === "agilityFailed" && mv.stopped.data.sixes === 0 && api.zoneOfToken(m3).zone === "z3" && asked.length === 2, "a listener stops the move before its second step: the token stays in the zone it reached");
// nobody answers for a border that is blocked: the move stops there
await api.apply(mv.inverse); await api.restoreBorders(); take(); asked.length = 0;
answer = () => undefined;
mv = await api.move(m3, null, { plan: api.forcedChain(m3, { awayFrom: m2, distance: 3 }) });
check(mv.ok && mv.done === 0 && mv.stopped.reason === "blocked" && mv.stopped.index === 0 && mv.inverse === null && api.zoneOfToken(m3).zone === "z2" && asked[0].forced === true, "a forced move into a locked door nobody answered for: stopped in front of it");
// the listener lets it pass (the combat module judged the barrier pierced without changing it)
answer = (ctx) => (ctx.index === 0 ? { pass: true } : undefined);
mv = await api.move(m3, null, { plan: api.forcedChain(m3, { awayFrom: m2, distance: 3 }) });
check(mv.done === 1 && mv.stopped.index === 1 && mv.stopped.reason === "blocked" && api.zoneOfToken(m3).zone === "z3", "passed through the first barrier, stopped by the second");
await api.apply(mv.inverse); take(); asked.length = 0;
const stale = api.plan(m1, "z1");
await m1.update({ x: 0, y: 100 });
check((await api.move(m3, null, { plan: api.plan("z1", "z1") })).reason === "stalePlan" && stale !== null, "a plan made for another place is refused");
off();

/* ---- a forced chain straight up or down (z3: a building with two floors) */
{
  const put = await api.moveToZone(m3, "z3");
  const up = api.forcedChain(m3, { direction: "up", distance: 5 });
  check(up.forced && up.vertical && up.steps.map((s) => s.to).join() === "z3:f1,z3:f2,z3:elevated" && up.steps.map((s) => s.slab).join() === "floor,floor,roof" && up.steps.every((s) => s.kind === "level" && s.dir === 1)
    && up.ray.end === "top" && up.ray.dz === 1 && up.ray.dx === 0 && up.end.airborne === true && up.total === 3 && up.borders === 0 && up.zones.join() === "z3" && up.from.spot === "z3",
    "forcedChain up inside a building: its floors and its roof in order, ending in the air above it; nothing above that");
  const two = api.forcedChain(m3, { direction: { vertical: "up" }, distance: 2 }), dz = api.forcedChain(m3, { direction: { dz: 1 }, distance: 1 });
  check(two.total === 2 && two.ray.end === "distance" && two.end.spot === "z3:f2" && two.end.level === "floor" && dz.end.spot === "z3:f1" && api.forcedChain(m3, { direction: { dx: 1, dy: 0, dz: 1 }, distance: 1 }).vertical !== true,
    "a distance shorter than the building ends on a floor; { vertical }, { dz } and \"up\" say the same; with dx / dy it is a chain along the map");
  const open = api.forcedChain(m2, { direction: "up", distance: 3 }), none = api.forcedChain(m2, { direction: "down", distance: 2 }), fall = api.forcedChain(m4, { direction: "down", distance: 3 });
  check(open.total === 1 && open.steps[0].to === "z1:elevated" && open.steps[0].slab === null && open.ray.end === "top" && open.way === "walk" && none.total === 0 && none.ray.end === "ground" && none.end.spot === "z1"
    && fall.total === 1 && fall.steps[0].to === "z5" && fall.ray.end === "ground" && fall.way === "air", "open ground: one zone up into the air, nowhere down; an airborne mover comes down to the ground");
  check(api.forcedChain("z1:underground", { direction: "up", distance: 2 }).steps.map((s) => `${s.to}/${s.slab}`).join() === "z1/ground,z1:elevated/null", "from underground: out through the ground first");
  // moving along it: the listeners get what each step passes through and may stop it there
  const heard = [];
  const offV = api.beforeStep((ctx) => { heard.push([ctx.step.to, ctx.step.slab, ctx.forced]); return ctx.step.slab === "roof" ? { stop: true, reason: "roof" } : undefined; });
  take();
  let mvV = await api.move(m3, null, { plan: up });
  const evV = take();
  check(mvV.ok && mvV.done === 2 && mvV.stopped.reason === "roof" && api.zoneOfToken(m3).spot === "z3:f2" && J(heard) === J([["z3:f1", "floor", true], ["z3:f2", "floor", true], ["z3:elevated", "roof", true]]) && evV.filter((e) => e.type === "tokenEntered").every((e) => e.levelChanged && !e.zoneChanged),
    "moved up floor by floor; a listener stopped it under the roof; every step is a change of level, not of zone");
  offV();
  const edV = api.planAlong(m3, ["z3"], { forced: true, end: { level: "elevated", airborne: true } });
  check(edV.forced && edV.vertical && edV.steps.map((s) => s.to).join() === "z3:elevated" && edV.steps[0].slab === "roof" && api.planAlong(m3, ["z3"], { forced: true, end: { level: "ground" } }).steps.map((s) => s.to).join() === "z3:f1,z3",
    "a chain the GM edited inside one zone goes rung by rung too");
  const down = api.forcedChain(m3, { direction: "down", distance: 9 });
  const mvD = await api.move(m3, null, { plan: down });
  check(down.steps.map((s) => s.to).join() === "z3:f1,z3" && down.ray.end === "ground" && mvD.done === 2 && api.zoneOfToken(m3).spot === "z3", "and down again to the ground, where it ends");
  await api.apply(mvD.inverse); await api.apply(mvV.inverse); await api.apply(put.inverse);
  check(api.zoneOfToken(m3).spot === "z2" && m3.x === 200 && m3.y === 0, "all of it taken back");
}

/* ---- a client that draws no frames (this test's requestAnimationFrame never calls back): no animation, nothing waited for */
{
  const raf0 = globalThis.requestAnimationFrame;
  check((await api.drawsFrames(0)) === false, "drawsFrames(): no frame came - none are drawn");
  writes.length = 0;
  let t0 = Date.now();
  let mvF = await api.move(m3, "z1", { profile: { way: "burrow" } });
  check(mvF.ok && mvF.done === 1 && mvF.animated === false && writes.at(-1).options.animate === false && Date.now() - t0 < 1500, "a move there is written without animation and says so");
  let un = await api.apply(mvF.inverse);
  check(un.ok && writes.at(-1).options.animate === false && api.zoneOfToken(m3).spot === "z2", "its undo too");
  mvF = await api.move(m3, "z1", { profile: { way: "burrow" }, options: { animate: true } });
  check(writes.at(-1).options.animate === true, "a caller that says `animate` itself is left alone");
  await api.apply(mvF.inverse);
  globalThis.requestAnimationFrame = (fn) => { setTimeout(fn, 1); return 1; };
  await new Promise((res) => setTimeout(res, 1100));
  writes.length = 0;
  mvF = await api.move(m3, "z1", { profile: { way: "burrow" } });
  check((await api.drawsFrames()) === true && mvF.animated === true && !("animate" in writes.at(-1).options), "frames are drawn again: the move is animated as before");
  await api.apply(mvF.inverse);
  globalThis.requestAnimationFrame = raf0;
  await new Promise((res) => setTimeout(res, 1100));
}
mv = await api.move(m2, "z1", {});
check(asked.length === 0, "a listener that stopped asking is not asked");

/* ---- levels, groups */
await api.setBorderState("z2|z3", { door: { state: "open" } }); take();
mv = await api.move(m3, "z3:f2", { profile: { way: "walk", speed: 4 } });
check(mv.ok && mv.done === 3 && api.zoneOfToken(m3).spot === "z3:f2" && m3.flags[MOD].floor === 2, "walking into the building and up two floors: three steps, the last two change the level only");
const invUp = mv.inverse;
mv = await api.move(m3, "z3:elevated", { profile: { way: "walk" } });
check(mv.ok && api.zoneOfToken(m3).roof === true && m3.flags[MOD].air === undefined, "one more floor up is the rooftop: stood on, not flown over");
await api.apply({ op: "batch", ops: [mv.inverse, invUp] });
check(api.zoneOfToken(m3).spot === "z2" && J(m3.flags[MOD]) === "{}", "both moves taken back in one batch: on the ground in z2, no flags left");
// a flyer carries another: one write per step for both, both end in the air in the same zone
await api.setBorderState("z3|z4", { wall: { state: "intact" } });
writes.length = 0; take();
mv = await api.move(m3, { zone: "z5", level: "elevated", airborne: true }, { profile: { way: "flight", speed: 4 }, group: [m2, m2, m3] });
ev = take();
check(mv.ok && mv.done === 3 && api.zoneOfToken(m3).spot === "z5:elevated" && api.zoneOfToken(m2).spot === "z5:elevated" && api.zoneOfToken(m2).airborne && api.zoneOfToken(m3).airborne, "a flyer carries a companion: both end airborne in the same zone (book-dump 2392)");
check(writes.length === 3 && writes.every((w) => w.ids.join() === "t3,t2") && !(m2.x === m3.x && m2.y === m3.y) && ev.filter((e) => e.type === "moveStep").length === 3 && ev.find((e) => e.type === "moveStarted").group.join() === "t2", "a group moves as one operation: one write per step for all, each on its own spot");
check(mv.inverse.rows.length === 2, "one inverse for the whole group");
await api.apply(mv.inverse);
check(api.zoneOfToken(m2).spot === "z1" && api.zoneOfToken(m3).spot === "z2", "the group is back");

/* ---- moveToZone: into a free spot, no steps */
take(); writes.length = 0;
mv = await api.moveToZone(m1, "z5");
check(mv.ok && mv.place.zone === "z5" && api.zoneAt(m1.x + 50, m1.y + 50) === 4 && !sm.tokens.some((t) => t !== m1 && t.x === m1.x && t.y === m1.y) && writes.length === 1, "moveToZone: into a free spot of the zone, one write");
r = await api.moveToZone(m1, "@sky");
check(r.ok && api.zoneOfToken(m1).spot === "@sky" && api.zoneOfToken(m1).below === "z5", "moveToZone off the map: the level only");
await api.apply(r.inverse); await api.apply(mv.inverse);
check(api.zoneOfToken(m1).spot === "z1" && m1.x === 0 && m1.y === 100, "both taken back");
check((await api.moveToZone(m1, "zz")).reason === "noZone" && (await api.moveToZone(null, "z1")).reason === "noToken", "bad calls are refused");
m1.isOwner = false;
check((await api.move(m1, "z1")).reason === "notOwner" && (await api.moveToZone(m1, "z5")).reason === "notOwner", "a token that is not the caller's to move is not moved");
m1.isOwner = true;

/* ---- cost confirmation on a dragged token */
take(); writes.length = 0;
await m2.update({ x: 300, y: 0 }); await m2.update({ x: 200, y: 0 });
check(api.tacticalOn() === false && writes.length === 0, "tactical play off: a drag is a drag");
const confirms = [];
let say = true;
api.tactical({ gm: true, profile: (doc) => ({ way: "walk", speed: doc.id === "t2" ? 2 : 1, stress: true }), confirm: async (ctx) => { confirms.push(ctx); return say; } });
await m2.update({ x: 250, y: 100 });
check(confirms.length === 0 && m2.x === 250, "a drag inside the zone goes through unasked (moving inside a zone is free: 2383)");
let res = await m2.update({ x: 450, y: 0 });
await new Promise((x) => setTimeout(x, 20));
check(res === undefined && confirms.length === 1 && confirms[0].reachable && confirms[0].cost.total === 1 && confirms[0].cost.within === "plain" && confirms[0].from.zone === "z2" && confirms[0].to.zone === "z3" && confirms[0].drop.x === 500, "a drag into another zone is held: the route and its cost go to confirm()");
check(api.zoneOfToken(m2).zone === "z3" && writes.length === 1 && !!writes[0].options.mmMove && api.zoneAt(m2.x + 50, m2.y + 50) === 2, "confirmed: the map moves the token along the plan (through move(), so the listeners would be asked)");
say = false;
await m2.update({ x: 250, y: 0 });
await new Promise((x) => setTimeout(x, 20));
check(confirms.length === 2 && api.zoneOfToken(m2).zone === "z3", "refused (or sent on as an intent by the combat module): the token stays");
await api.setBorderState("z2|z3", { door: { state: "locked" } });
say = true;
await m2.update({ x: 250, y: 0 });
await new Promise((x) => setTimeout(x, 20));
check(confirms.length === 3 && confirms[2].reachable === false && confirms[2].plan === null && api.zoneOfToken(m2).zone === "z3", "no way there: confirm() is told so, and a yes moves nothing");
api.tactical({ confirm: async () => { confirms.push("gm"); return true; } });
await m2.update({ x: 250, y: 0 });
check(m2.x === 250 && confirms.length === 3, "the GM's own drags are not asked unless told to");
api.tactical(false);
check(api.tacticalOn() === false, "off again");

/* ---- drawing: every wall and door state goes through the border drawing without an error (stand-in graphics: what is drawn is
   not looked at here - that needs a live canvas) */
const drawn = [];
const G = () => new Proxy({}, { get: (t, k) => (k === "destroyed" ? false : typeof k === "symbol" ? undefined : (...a) => { if ( k === "drawPolygon" || k === "lineTo" || k === "drawRect" || k === "drawCircle" ) drawn.push(k); return G(); }) });
const D = await imp("scripts/zones/display.mjs");
const Mk = await imp("scripts/zones/marks.mjs"), Geo = await imp("scripts/zones/geometry.mjs");
const Zd = api.zones();
const walls = [[200, 100, "wall"], [400, 100, "locked"], [600, 100, "outer", { door: { state: "sealed" } }], [800, 100, "door"]];
const drawWalls = Object.getOwnPropertyNames(D.ZoneDisplay.prototype).includes("drawWalls") ? D.ZoneDisplay.prototype.drawWalls : null;
let threw = null;
for ( const plays of [[], [[200, 100, { w: "breached" }], [400, 100, { d: "open" }], [800, 100, { d: "breached" }]], [[200, 100, { w: "removed", t: 1 }], [400, 100, { d: "sealed" }], [600, 100, { w: "breached" }]]] ) {
  const Md = Mk.resolve(Zd, walls, [], (x, y) => Geo.zoneAt(Zd, x, y), 35, plays);
  try { drawWalls.call({ M: Md, Z: Zd }, G(), 1, 4, 0xffffff); } catch ( err ) { threw = err; }
}
check(drawWalls && !threw && drawn.includes("drawPolygon") && drawn.includes("drawRect") && drawn.includes("drawCircle"), `every wall and door state draws without an error${threw ? `: ${threw.message}` : ""}`);

console.log(failed ? `${failed} failed` : "all zones play checks passed");
process.exit(failed ? 1 : 0);
