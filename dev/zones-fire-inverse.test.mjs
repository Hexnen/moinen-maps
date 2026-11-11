// Zones: the inverse of a fire write carries what was done on the FIRE LAYER (U72, zones-api.md section 12): a fire that existed only
// as painted strokes comes back as those strokes (the same ids, paths, levels, colours, place in the paint order), a fire the write
// painted is the one its inverse puts out, an inverse stays true after the strokes' records are gone from the scene, and an op
// without fire is as it was. The tree's real zones.mjs and fire.mjs over a stand-in Foundry.   node dev/zones-fire-inverse.test.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
const MOD = "moinen-maps";

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if ( !ok ) failed++; };
const J = JSON.stringify;
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- a stand-in Foundry (as dev/zones-api.test.mjs), with a scene that keeps every flag it is given */
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
const gm = { isGM: true, id: "gm" }, player = { isGM: false, id: "p1" };
globalThis.game = {
  user: gm,
  i18n: { lang: "en", localize: (k) => k, format: (k) => k, has: () => false },
  settings: { register: (m, k, o) => settings.set(k, o.default), get: (m, k) => (settings.has(k) ? settings.get(k) : k === "fireWind" || k === "fireWindDir" ? 0 : (() => { throw new Error(`no setting ${k}`); })()) },
  scenes: { get: () => scene },
  modules: { get: () => ({}) }
};
let scene = null;
// (a scene update MERGES: dotted keys, "-=" deletes a key)
function merge(target, flat) {
  for ( const [k, v] of Object.entries(flat) ) {
    const ps = k.split("."); let t = target;
    for ( const p of ps.slice(0, -1) ) t = t[p] ??= {};
    const last = ps.at(-1);
    if ( last.startsWith("-=") ) delete t[last.slice(2)];
    else if ( v && typeof v === "object" && !Array.isArray(v) && t[last] && typeof t[last] === "object" && ps.length > 3 ) Object.assign(t[last], JSON.parse(J(v)));
    else t[last] = JSON.parse(J(v));
  }
}
function makeScene(flag) {
  // (the fire layer is switched off for drawing - there is no renderer here; its strokes are stored and read by the zones all the same)
  const s = { id: "scene1", flags: { [MOD]: { zones: flag, fire: { on: false } } }, saves: 0, tokens: [] };
  s.update = async (data) => { s.saves++; merge(s, data); return s; };
  return s;
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
const warn0 = console.warn;
console.warn = (...a) => { if ( process.env.ZONES_WARN ) warn0(...a); };

const Zones = await imp("scripts/zones/zones.mjs");
const Fire = await imp("scripts/fire/fire.mjs");
Fire.registerFire();
Zones.registerZones();
Hooks.callAll("init");
const api = Zones.zonesApi, fire = Fire.fireApi;

// a row of four zones (dividers at 200, 400, 600 inside the 800 x 200 scene), nothing drawn
const flag = { v: 1, s: [[1, [200, -20, 200, 220]], [2, [400, -20, 400, 220]], [3, [600, -20, 600, 220]]], next: 4, preset: null, snap: 0.25, smooth: 0, look: { who: "none" } };
const sc = makeScene(flag);
open(sc);
check(J(api.keys()) === J(["z1", "z2", "z3", "z4"]) && api.canWrite() === true, "four zones, this client writes");

const burning = () => fire.list().map((s) => s.id).sort();
const fireOf = (z) => api.zone(z)?.states?.fire ?? 0;
const ownFire = (z) => Zones.ownMarks()?.zones.get(api.idOf(z))?.fire ?? null;
const painted = (z) => api.zoneStates(z).filter((s) => s.kind === "fire" && s.source === "map").map((s) => s.level);
const WAIT = 260;                                   // (the zones read the layers again 150 ms after the fire layer last changed)
const same = (a, b) => { const strip = ({ g, ...r }) => r; return J(strip(a)) === J(strip(b)); };

/* ---- 1. a fire that exists only as painted strokes (the GM's brush: two strokes in z2, one in z3) */
const a1 = fire.paint([[240, 60], [300, 100], [360, 140]], { radius: 45, level: 3, smoke: 3, color: "#33ccff", torn: 0.4 });
const a2 = fire.paint([[260, 150], [330, 60]], { radius: 30, level: 1, smoke: 1 });
const b1 = fire.paint([[500, 100]], { radius: 60, level: 2 });
await tick(WAIT);
const orderBefore = fire.list().map((s) => s.id);            // (the paint order: by paint time, then id)
const before = fire.list().filter((s) => s.id === a1.id || s.id === a2.id).map((s) => JSON.parse(J(s)));
check(burning().length === 3 && fireOf("z2") === 10 && fireOf("z3") === 8 && ownFire("z2") === null && J(painted("z2")) === J([10]), "painted strokes make z2 burn at Intensity 10 with no mark of the GM under it");

const out = await api.apply({ op: "zone", zone: "z2", patch: { fire: null } });
await tick(WAIT);
check(out.ok && out.changed === true && J(burning()) === J([b1.id]) && fireOf("z2") === 0 && fireOf("z3") === 8, "the fire is put out for a combat action: its strokes go, the neighbour's stay; changed");
const inv = JSON.parse(J(out.inverse));            // (as an undo journal stores it: plain data)
check(inv.op === "zone" && inv.zone === "z2" && J(inv.patch) === J({ fire: null }) && inv.fireLayer && J(inv.fireLayer.out) === "[]" && J(inv.fireLayer.back.map((s) => s.id).sort()) === J([a1.id, a2.id].sort())
  && inv.fireLayer.back.every((r) => J(r) === J(before.find((s) => s.id === r.id))), "U72: its inverse carries the strokes that went, exactly as they were");

const undo = await api.apply(inv);
check(undo.ok && undo.changed === true && J(burning()) === J([a1.id, a2.id, b1.id].sort()), "U72: the inverse gives the strokes back at once (the same ids)");
const now = fire.list().filter((s) => s.id === a1.id || s.id === a2.id);
check(now.every((s) => same(s, before.find((q) => q.id === s.id)) && s.o === undefined && Number.isFinite(s.g)) && J(fire.list().map((s) => s.id)) === J(orderBefore),
  "U72: path, radius, levels, colour, torn edge, seed and paint order as before; only the time they are lit again is new");
const stored = sc.flags[MOD].fireStrokes;
check(stored[a1.id] && stored[a1.id].o === undefined && stored[a2.id].o === undefined && J(stored[a1.id].p) === J(before.find((s) => s.id === a1.id).p), "the scene stores them burning again (no out time left behind)");
await tick(WAIT);
check(fireOf("z2") === 10 && ownFire("z2") === null && J(painted("z2")) === J([10]), "U72: the zone burns again at the Intensity it had, still with no mark of the GM (nothing was invented)");

/* ---- 2. the inverse of the inverse puts them out again, and so on (a redo, an undo) */
const redoOp = JSON.parse(J(undo.inverse));
check(J(redoOp.patch) === J({ fire: null }) && J(redoOp.fireLayer.back) === "[]" && J(redoOp.fireLayer.out.sort()) === J([a1.id, a2.id].sort()), "the inverse's own inverse names the strokes it gave back");
const redo = await api.apply(redoOp);
check(redo.ok && redo.changed && J(burning()) === J([b1.id]) && J(redo.inverse.fireLayer.back.map((s) => s.id).sort()) === J([a1.id, a2.id].sort()), "applied: exactly those go out again");
const undo2 = await api.apply(JSON.parse(J(redo.inverse)));
check(undo2.ok && J(burning()) === J([a1.id, a2.id, b1.id].sort()), "and come back again");
const twice = await api.apply(JSON.parse(J(redo.inverse)));
check(twice.ok && twice.changed === false && J(twice.inverse.fireLayer) === J({ back: [], out: [] }) && J(burning()) === J([a1.id, a2.id, b1.id].sort()), "the same inverse a second time: nothing to do, nothing lit twice (changed: false)");

/* ---- 3. the strokes' records are gone from the scene by the time of the undo (their going-out is over, the GM's client removed them) */
const o3 = await api.apply({ op: "zone", zone: "z2", patch: { fire: null } });
const inv3 = JSON.parse(J(o3.inverse));
delete sc.flags[MOD].fireStrokes[a1.id]; delete sc.flags[MOD].fireStrokes[a2.id];
open(sc);                                           // (the scene read anew: the fire layer knows only what the scene stores)
check(J(burning()) === J([b1.id]) && inv3.fireLayer.back.length === 2, "the records of the strokes put out are gone from the scene");
const u3 = await api.apply(inv3);
await tick(WAIT);
check(u3.ok && J(burning()) === J([a1.id, a2.id, b1.id].sort()) && fire.list().filter((s) => s.id !== b1.id).every((s) => same(s, before.find((q) => q.id === s.id))) && fireOf("z2") === 10,
  "U72: the inverse still gives them back whole, from what it carries");

/* ---- 4. a fire the write itself painted: its inverse puts out THAT stroke, not whatever burns in the zone by then */
const set = await api.apply({ op: "zone", zone: "z1", patch: { fire: 8 } });
const blob = burning().find((id) => ![a1.id, a2.id, b1.id].includes(id));
check(set.ok && set.changed && blob && ownFire("z1") === 8 && J(set.inverse.patch) === J({ fire: null }) && J(set.inverse.fireLayer) === J({ back: [], out: [blob] }), "a new fire: the mark is written, one fire painted; the inverse names the painted stroke");
await tick(WAIT);
const hand = fire.paint([[60, 60]], { radius: 40, level: 3 });          // the GM paints more fire into the same zone by hand
await tick(WAIT);
const unset = await api.apply(JSON.parse(J(set.inverse)));
await tick(WAIT);
check(unset.ok && !burning().includes(blob) && burning().includes(hand.id) && ownFire("z1") === null && fireOf("z1") === 10, "its inverse: the mark and the painted fire go, the GM's own stroke painted since stays");
const reset = await api.apply(JSON.parse(J(unset.inverse)));
check(reset.ok && burning().includes(blob) && ownFire("z1") === 8 && burning().filter((id) => ![a1.id, a2.id, b1.id, hand.id].includes(id)).length === 1, "and back: the same painted fire again (not a second one), the mark again");

/* ---- 5. lowered below what the painted fire reads as: the old strokes out, a lower one painted; the inverse swaps them back */
const c1 = fire.paint([[700, 100]], { radius: 70, level: 3 });
await tick(WAIT);
check(fireOf("z4") === 10 && ownFire("z4") === null, "z4 burns at 10, painted only");
const low = await api.apply({ op: "zone", zone: "z4", patch: { fire: 6 } });
const lowBlob = burning().find((id) => ![a1.id, a2.id, b1.id, hand.id, blob, c1.id].includes(id));
check(low.ok && !burning().includes(c1.id) && lowBlob && ownFire("z4") === 6 && J(low.inverse.fireLayer.out) === J([lowBlob]) && J(low.inverse.fireLayer.back.map((s) => s.id)) === J([c1.id]), "lowered to 6: the blaze goes, a small fire is painted; the inverse carries both");
const lowUndo = await api.apply(JSON.parse(J(low.inverse)));            // (at once: nothing waits for the zones to read the layers again)
await tick(WAIT);
check(lowUndo.ok && burning().includes(c1.id) && !burning().includes(lowBlob) && ownFire("z4") === null && fireOf("z4") === 10, "its inverse: the small fire out, the blaze back, no mark: as before the write");

/* ---- 5b. the inverse as the combat module rewrites it today (its own way round the old empty inverse: the Intensity the layer showed
        put into the patch): the strokes still come back once, no second fire is painted; the zone only gets a mark it did not have */
const w = await api.apply({ op: "zone", zone: "z4", patch: { fire: null } });
const rewritten = JSON.parse(J(w.inverse)); rewritten.patch.fire = 10;
const nW = burning().length;
const wu = await api.apply(rewritten);
await tick(WAIT);
check(wu.ok && burning().length === nW + 1 && burning().includes(c1.id) && fireOf("z4") === 10 && ownFire("z4") === 10, "the combat module's rewritten inverse: the blaze back once, nothing painted beside it (plus the mark that module asks for)");
await api.apply(JSON.parse(J(wu.inverse)));
await api.apply(JSON.parse(J(w.inverse)));
await tick(WAIT);
check(burning().includes(c1.id) && ownFire("z4") === null && fireOf("z4") === 10, "(taken back: z4 burns painted only again)");

/* ---- 6. what did not change */
const dark = await api.apply({ op: "zone", zone: "z3", patch: { dark: true } });
check(dark.ok && J(dark.inverse) === J({ op: "zone", zone: "z3", patch: { dark: null } }), "a write without fire: the inverse is as it always was (no fireLayer)");
const noop = await api.apply({ op: "zone", zone: "z3", patch: { fire: null, dark: true } });
check(noop.ok && noop.inverse.fireLayer && noop.inverse.fireLayer.back.length === 1, "fire put out together with other marks: one inverse for both");
await api.apply(JSON.parse(J(noop.inverse)));
check(burning().includes(b1.id), "(and back)");
const bad = await api.apply({ op: "zone", zone: "z3", patch: { dark: null }, fireLayer: { back: "x" } }), bad2 = await api.apply({ op: "zone", zone: "z3", patch: { dark: null }, fireLayer: null });
check(bad.ok === false && bad.reason === "badOp" && bad2.ok === false && bad2.reason === "badOp" && Zones.ownMarks().zones.get(2)?.dark === true, "a fireLayer that is no { back: [], out: [] }: badOp, nothing written");
const junk = await api.apply({ op: "zone", zone: "z3", patch: {}, fireLayer: { back: [null, 7, { id: "x y", k: "fire", p: [1, 2] }, { id: "nope", k: "burst", p: [1, 2] }], out: [5, "no-such-stroke"] } });
check(junk.ok && junk.changed === false && J(junk.inverse.fireLayer) === J({ back: [], out: [] }), "records that are no strokes and ids that name none do nothing");
const n0 = burning().length;
check(J(Fire.giveBack([{ ...before[0], id: "gone1", o: 5 }])) === "[]" && burning().length === n0, "a stroke whose own out time has passed is not brought back");
game.user = player;
const pl = await api.apply(JSON.parse(J(out.inverse)));
check(pl.ok === false && pl.reason === "notGM" && J(Fire.giveBack(before)) === "[]", "a player's client: refused, the fire layer gives nothing back");
game.user = gm;

console.log(failed ? `${failed} failed` : "all zones fire inverse checks passed");
process.exit(failed ? 1 : 0);
