// Zones, the interface part: highlights (what they are, who gets them, what is drawn), picking a zone by click (here and asked
// of another user), the GM's border editor write (editBorder), who runs the rules (the fire round, the wrecking numbers, the
// distance badges) and the words of a refused write - with a stand-in Foundry and a recording stand-in PIXI (what is drawn is
// counted, not looked at: that needs a live canvas).   node dev/zones-interact.test.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
const MOD = "moinen-maps";

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if ( !ok ) failed++; };
const J = JSON.stringify;
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

/* ---- a stand-in PIXI that records what is drawn */
const calls = [];                                                      // every Graphics call: [name, ...args]
const anyFn = () => new Proxy(class Any {}, { get: (t, k) => (typeof k === "symbol" ? undefined : k === "prototype" ? t.prototype : anyFn()), apply: () => anyFn(), construct: () => anyFn() });
class Node {
  constructor() { this.children = []; this.visible = true; this.destroyed = false; this.scale = { x: 1, set: (v) => { this.scale.x = v; } }; this.position = { x: 0, y: 0, set: (x, y) => { this.position.x = x; this.position.y = y; } }; this.anchor = { set() {} }; }
  addChild(...c) { this.children.push(...c); return c[0]; }
  removeChildren() { const c = this.children; this.children = []; return c; }
  destroy() { this.destroyed = true; }
  getBounds() { return { x: 0, y: 0, width: 0, height: 0 }; }
}
const recorder = (kind) => class extends Node {
  constructor(...a) {
    super(); this.kind = kind; this.args = a; this.texture = a[0]; this.width = 20; this.height = 12;
    return new Proxy(this, { get: (t, k, r) => (k in t || typeof k === "symbol" ? Reflect.get(t, k, r) : (...args) => { calls.push([k, ...args]); return r; }) });
  }
};
const texts = [];
const pixi = {
  Container: Node, Graphics: recorder("g"), Sprite: recorder("s"),
  Text: class extends Node { constructor(text, style) { super(); this.text = text; this.style = style; this.width = String(text).length * 7; texts.push(this); } },
  Texture: { EMPTY: {}, from: () => ({ destroy() {} }) },
  LINE_CAP: { ROUND: "round" }, LINE_JOIN: { ROUND: "round", MITER: "miter" }, BLEND_MODES: { ADD: 1, MULTIPLY: 2, NORMAL: 0 }
};
globalThis.PIXI = new Proxy(pixi, { get: (t, k) => (k in t ? t[k] : typeof k === "symbol" ? undefined : anyFn()) });

// (the chunk decoder says it has no Worker in node: not this test's business)
const warn0 = console.warn; console.warn = (...a) => { if ( !/chunk worker|style wash/.test(String(a[0])) ) warn0(...a); };

/* ---- a stand-in Foundry */
const hooks = new Map();
globalThis.Hooks = {
  on(name, fn) { if ( !hooks.has(name) ) hooks.set(name, []); hooks.get(name).push(fn); return fn; },
  once(name, fn) { return this.on(name, fn); },
  off(name, fn) { const l = hooks.get(name); if ( l?.includes(fn) ) l.splice(l.indexOf(fn), 1); },
  callAll(name, ...args) { for ( const fn of [...(hooks.get(name) ?? [])] ) fn(...args); return true; },
  call(name, ...args) { for ( const fn of [...(hooks.get(name) ?? [])] ) if ( fn(...args) === false ) return false; return true; }
};
const listeners = (o) => { o.ls = new Map(); o.addEventListener = (t, fn) => { (o.ls.get(t) ?? o.ls.set(t, []).get(t)).push(fn); }; o.removeEventListener = (t, fn) => { const l = o.ls.get(t); if ( l?.includes(fn) ) l.splice(l.indexOf(fn), 1); }; o.fire = (t, ev = {}) => { for ( const fn of [...(o.ls.get(t) ?? [])] ) fn({ preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...ev }); }; return o; };
const classList = () => { const s = new Set(); return { add: (...c) => c.forEach((x) => s.add(x)), remove: (...c) => c.forEach((x) => s.delete(x)), toggle: (c, on) => (on ? s.add(c) : s.delete(c)), contains: (c) => s.has(c), s }; };
const els = [];
const makeEl = () => { const e = listeners({ className: "", classList: classList(), style: {}, innerHTML: "", gone: false, setAttribute() {}, remove() { e.gone = true; }, append() {}, querySelector: () => e.btn ??= makeEl(), contains: () => false }); els.push(e); return e; };
const settings = new Map();
globalThis.foundry = anyFn();
globalThis.CONFIG = {};
globalThis.window = listeners(globalThis);
globalThis.document = listeners({ visibilityState: "visible", body: { append() {}, classList: classList() }, createElement: makeEl });
globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };
globalThis.cancelAnimationFrame = () => {};
const notes = [];
globalThis.ui = { notifications: { info: (m) => notes.push(["info", m]), warn: (m) => notes.push(["warn", m]) } };
const chats = [];
globalThis.ChatMessage = { create: async (d) => { chats.push(d); } };
const sent = [];                                                       // every socket message: { msg, to }
let onSocket = null;
const users = new Map([["gm", { id: "gm", isGM: true, active: true, name: "Ada" }], ["gm2", { id: "gm2", isGM: true, active: true, name: "Bo" }], ["p1", { id: "p1", isGM: false, active: true, name: "Test Gracz 1" }], ["p2", { id: "p2", isGM: false, active: true, name: "Test Gracz 2" }]]);
globalThis.game = {
  user: users.get("gm"),
  users: { activeGM: users.get("gm"), get: (id) => users.get(id), filter: (fn) => [...users.values()].filter(fn) },
  i18n: { lang: "en", localize: (k) => k, format: (k, d) => `${k}${d ? J(d) : ""}`, has: () => false },
  settings: { register: (m, k, o) => settings.set(k, o.default), get: (m, k) => { if ( !settings.has(k) ) throw new Error(`no setting ${k}`); return settings.get(k); } },
  scenes: { get: () => scene },
  modules: { get: () => ({ title: "Plus Ultra" }) },
  socket: { emit: (ch, msg, o) => sent.push({ msg, to: o?.recipients ?? null }), on: (ch, fn) => { onSocket = fn; } }
};
const takeSent = () => sent.splice(0);

let scene = null;
function makeScene(flag, tokens = []) {
  const s = { id: "scene1", flags: { [MOD]: flag ? { zones: flag } : {} }, saves: 0 };
  s.update = async (data) => { s.saves++; for ( const [k, v] of Object.entries(data) ) if ( k === `flags.${MOD}.zones` ) s.flags[MOD].zones = JSON.parse(JSON.stringify(v)); return s; };
  s.tokens = tokens.map(([id, x, y]) => ({ id, name: id, uuid: `Scene.${s.id}.Token.${id}`, x, y, width: 1, height: 1, isOwner: true, parent: s, documentName: "Token", flags: { [MOD]: {} }, getFlag: () => undefined, object: null }));
  return s;
}
let view = null;
function open(s) {
  scene = s;
  view = listeners({ getBoundingClientRect: () => ({ left: 0, top: 0 }) });
  globalThis.canvas = {
    scene: s, ready: true, dimensions: { size: 100, width: 1000, height: 400, sceneRect: { x: 0, y: 0, width: 1000, height: 200 } }, grid: { size: 100 },
    app: { view, ticker: { fns: new Set(), add(f) { this.fns.add(f); }, remove(f) { this.fns.delete(f); } }, renderer: anyFn() },
    primary: new Node(), interface: new Node(), tokens: { controlled: [], placeables: [] }, stage: { scale: { x: 1 } },
    canvasCoordinatesFromClient: (p) => ({ x: p.x, y: p.y })
  };
  Hooks.callAll("canvasReady");
}

const Zones = await imp("scripts/zones/zones.mjs");
const HL = await imp("scripts/zones/highlight.mjs");
Zones.registerZones();
Hooks.callAll("init");
Hooks.callAll("ready");
const api = Zones.zonesApi;

/* ================================================================ the pure part */

check(HL.colorOf("move") === 0x5cc8ff && HL.colorOf("#f00") === 0xff0000 && HL.colorOf("#12ab34") === 0x12ab34 && HL.colorOf(0x112233) === 0x112233 && HL.colorOf("nope", 7) === 7 && HL.colorOf(null, 9) === 9, "a colour: a name, #rgb, #rrggbb or a number; anything else falls back");
check(HL.zoneKeyOf("z3:f2") === "z3" && HL.zoneKeyOf({ zone: "z4" }) === "z4" && HL.zoneKeyOf({ spot: "z5:elevated" }) === "z5" && HL.zoneKeyOf("@sky") === null && HL.zoneKeyOf(4) === null, "a zone entry names a zone by key, spot or place; an off-map area names none");
check(HL.borderKeyOf("z5|z2") === "z2|z5" && HL.borderKeyOf(["z5", "z2:elevated"]) === "z2|z5" && HL.borderKeyOf({ border: "z2|z1" }) === "z1|z2" && HL.borderKeyOf({ key: "z3|z4", zones: ["z3", "z4"] }) === "z3|z4" && HL.borderKeyOf("z1|z1") === null && HL.borderKeyOf("z1") === null, "a border entry names a border by key, pair or border object (keys sorted)");
let h = HL.cleanHighlight({ id: "a", color: "stress", zones: ["z1", "z1:elevated", { zone: "z2", color: "#ff0000", style: "dashed", label: "  two   words ", tip: "t" }, 7, "@sky"], borders: ["z2|z1", ["z2", "z3"], { border: "z3|z4", label: "Armor 3", style: "dashed" }, "bad"], users: ["p1", "p1"], order: "2" });
check(h.zones.length === 2 && h.zones[0].zone === "z1" && h.zones[0].color === 0xf2c14e && h.zones[0].style === "fill" && h.zones[1].color === 0xff0000 && h.zones[1].style === "dashed" && h.zones[1].label === "two words" && h.zones[1].tip === "t", "zone entries: one per zone, each with its colour, style, label and tip (the spec's are the defaults)");
check(J(h.borders.map((b) => b.border)) === J(["z1|z2", "z2|z3", "z3|z4"]) && h.borders[2].label === "Armor 3" && h.borders[2].style === "dashed" && h.borders[0].style === "solid" && J(h.users) === J(["p1"]) && h.order === 2, "border entries, the users and the order");
check(HL.cleanHighlight({ zones: [] }) === null && HL.cleanHighlight({ id: "bad id!", zones: ["z1"] }) === null && HL.cleanHighlight(null) === null && HL.cleanHighlight({ zones: ["z1"] }).id === null, "nothing to show, or an id that cannot be kept: no highlight; no id: one is given later");
check(HL.cleanHighlight({ zones: [{ zone: "z1", label: "x".repeat(80) }] }).zones[0].label.length === HL.LIMITS.label, "a label is cut to what fits on the map");
check(HL.cleanUsers(undefined) === null && HL.cleanUsers("me") === null && HL.cleanUsers("all") === "all" && HL.cleanUsers("gm") === "gm" && J(HL.cleanUsers("p1")) === J(["p1"]) && J(HL.cleanUsers([{ id: "p1" }, "p2"])) === J(["p1", "p2"]) && HL.cleanUsers(["gm"], "gm") === null && HL.cleanUsers([]) === null, "who it is for: nobody named - the maker alone; all; gm; ids or users");
check(J(HL.audience(null, "gm", ["gm"])) === J({ local: true, remote: null }) && J(HL.audience("all", "gm")) === J({ local: true, remote: "all" }) && J(HL.audience(["p1"], "gm")) === J({ local: false, remote: ["p1"] }) && J(HL.audience(["p1", "gm"], "gm")) === J({ local: true, remote: ["p1"] }) && J(HL.audience("gm", "gm", ["gm", "gm2"])) === J({ local: true, remote: ["gm2"] }) && J(HL.audience("gm", "gm", ["gm"])) === J({ local: true, remote: null }), "where it goes: shown here only when the maker is among its users, sent to the others");
const st = new HL.HighlightStore();
st.set({ id: "low", zones: [{ zone: "z1", color: 1, style: "fill", label: "L" }, { zone: "z2", color: 1, style: "fill", label: null }], borders: [{ border: "z1|z2", color: 1, style: "solid" }], order: 0 });
st.set({ id: "top", zones: [{ zone: "z1", color: 2, style: "outline", label: "T" }], borders: [], order: 5 });
st.set({ id: "late", zones: [{ zone: "z2", color: 3, style: "fill", label: null }, { zone: "zz", color: 3, style: "fill", label: null }], borders: [{ border: "z1|z3", color: 3, style: "solid" }], order: 0 });
const ids = { z1: 0, z2: 1, z3: 2 };
let cmp = st.compose((k) => ids[k] ?? -1, (a, b) => (Math.abs(a - b) === 1 ? `${Math.max(a, b)}|${Math.min(a, b)}` : null));
check(cmp.zones.size === 2 && cmp.zones.get(0).color === 2 && cmp.zones.get(0).of === "top" && cmp.zones.get(1).color === 3 && cmp.borders.size === 1 && cmp.borders.get("1|0").of === "low", "several highlights on one zone: the highest order shows, then the latest; a zone that is gone and a border between zones that are not neighbours are left out");
check(J(HL.groups(cmp.zones).map((g) => [g.color, g.style, g.ids])) === J([[2, "outline", [0]], [3, "fill", [1]]]), "zones of one colour and style are drawn together");
const v1 = st.version;
check(J(st.remove({ prefix: "l" })) === J(["low", "late"]) && st.size === 1 && st.version === v1 + 1 && st.remove({ id: "none" }).length === 0 && st.version === v1 + 1, "highlights go by id or by prefix; the version counts only real changes");
let P = HL.cleanPick({ zones: ["z1", "z2:elevated", { zone: "z3", label: "2", tip: "one action", color: "stress" }, "z1", 5], title: "Move", timeout: 500 });
check(P.zones.length === 3 && P.zones[1].zone === "z2" && P.zones[1].spot === "z2:elevated" && P.zones[2].label === "2" && P.zones[2].color === 0xf2c14e && P.zones[0].color === 0x5cc8ff && P.title === "Move" && P.timeout === 500, "a pick request: the zones on offer with the spot each answers with, labels and colours");
check(HL.cleanPick({}).zones === null && HL.cleanPick({ zones: ["@sky", 3] }) === null && HL.cleanPick({ zones: [] }) === null, "no list: any zone; a list that names no zone: nothing to pick");

/* ================================================================ wired: highlights */

// five zones in a row (dividers at 200, 400, 600, 800 in the 1000 x 200 scene): a wall z1|z2, a locked door z2|z3, an exterior
// wall z3|z4, z4|z5 open
const flag = {
  v: 1, s: [[1, [200, -20, 200, 220]], [2, [400, -20, 400, 220]], [3, [600, -20, 600, 220]], [4, [800, -20, 800, 220]]], next: 5, preset: null, snap: 0.25, smooth: 0,
  look: { who: "all", lineStyle: "solid" }, w: [[200, 100, "wall"], [400, 100, "locked"], [600, 100, "outer"]], m: [[500, 100, { building: true, terrain: "office" }]]
};
const sc = makeScene(JSON.parse(J(flag)), [["t1", 0, 0]]);
open(sc);
takeSent();
const layerRoot = () => canvas.primary.children.find((c) => c.sortLayer === 258 && c.sort === 1) ?? null;
check(layerRoot() === null && canvas.app.ticker.fns.size === 1, "nothing highlighted: no layer, nothing watched but the zones' own ticker");

calls.length = 0; texts.length = 0;
let id = api.highlight({ id: "reach", zones: [{ zone: "z2", label: "1" }, { zone: "z3", color: "stress", label: "2" }, "z9"], borders: [{ border: "z3|z2", color: "danger", label: "Armor 2" }] });
const fills = () => calls.filter((c) => c[0] === "beginFill").map((c) => c[1]);
check(id === "reach" && layerRoot()?.visible === true && fills().includes(0x5cc8ff) && fills().includes(0xf2c14e) && texts.map((t) => t.text).sort().join() === "1,2,Armor 2", "a highlight is drawn: a wash per colour, a label per entry (the unknown zone is left out)");
check(calls.some((c) => c[0] === "lineStyle" && c[1].color === 0xe06666) && calls.some((c) => c[0] === "lineStyle" && c[1].color === 0x15110f), "a highlighted border: its colour on a dark line (reads on light and dark maps)");
check(takeSent().length === 0 && api.highlights().length === 1 && api.highlights()[0].from === null, "nobody named: it stays on this client, nothing goes over the socket");
check(canvas.app.ticker.fns.size === 2, "the layer follows the zoom only while something shows");
calls.length = 0;
Hooks.callAll("moinenMapsZones", "params");
check(calls.filter((c) => c[0] === "beginFill").length === 0, "nothing changed: nothing is drawn again");
calls.length = 0;
canvas.stage.scale.x = 1.02; for ( const f of canvas.app.ticker.fns ) f();
const small = calls.filter((c) => c[0] === "beginFill").length;
canvas.stage.scale.x = 2; for ( const f of canvas.app.ticker.fns ) f();
check(small === 0 && calls.filter((c) => c[0] === "beginFill").length > 0, "a small zoom step only scales the labels; a big one draws the lines again at the new width");
const lab = layerRoot().children[4].children[0];
check(Math.abs(lab.scale.x - 0.5) < 1e-9, "labels keep their size on screen");
canvas.stage.scale.x = 1;

// sent to the users it is meant for, and only to them
id = api.highlight({ id: "p1move", zones: ["z2"], users: ["p1"] });
let out = takeSent();
check(out.length === 1 && J(out[0].to) === J(["p1"]) && out[0].msg.t === "zones" && out[0].msg.op === "hl" && out[0].msg.scene === "scene1" && out[0].msg.set[0].id === "p1move" && !("users" in out[0].msg.set[0]) && !api.highlights().some((x) => x.id === "p1move"), "for one player: it goes to that player alone and is not shown on the GM's screen");
api.highlight({ id: "p1move", zones: ["z3"], users: ["p2", "gm"] });
out = takeSent();
check(out.length === 2 && out[0].msg.del[0] === "p1move" && J(out[0].to) === J(["p1"]) && J(out[1].to) === J(["p2"]) && api.highlights().some((x) => x.id === "p1move"), "the same id for other users: the first player loses it, the new one gets it, the GM named among them sees it too");
api.highlight({ id: "everyone", zones: ["z4"], users: "all" });
out = takeSent();
check(out.length === 1 && out[0].to === null && out[0].msg.set[0].id === "everyone", "for all: one message to everyone");
api.highlight({ id: "gms", zones: ["z5"], users: "gm" });
out = takeSent();
check(out.length === 1 && J(out[0].to) === J(["gm2"]), "for the GMs: the other GM gets it");
// a client that opens the scene later asks, and gets what is meant for it
onSocket({ t: "zones", op: "hello", scene: "scene1" }, "p2");
out = takeSent();
check(out.length === 1 && J(out[0].to) === J(["p2"]) && J(out[0].msg.set.map((x) => x.id).sort()) === J(["everyone", "p1move"]), "a late client is sent again what is meant for it - and nothing else");
onSocket({ t: "zones", op: "hello", scene: "other" }, "p2");
check(takeSent().length === 0, "a client on another scene is sent nothing");
check(api.clearHighlights({ prefix: "p1" }) === 1 && J(takeSent().map((m) => [m.msg.del[0], m.to])) === J([["p1move", ["p2"]]]), "cleared: gone here and from the screens it was sent to");
check(api.clearHighlights() === 3 && takeSent().length === 2 && api.highlights().length === 0 && layerRoot().visible === false && canvas.app.ticker.fns.size === 1, "everything cleared: the layer hides and stops watching");

// the receiving side (a player's client)
game.user = users.get("p1");
onSocket({ t: "zones", op: "hl", scene: "scene1", set: [{ id: "fromgm", zones: [{ zone: "z2", color: 0x5cc8ff, style: "fill", label: "1" }], borders: [], users: "all" }] }, "gm");
check(api.highlights().length === 1 && api.highlights()[0].from === "gm" && layerRoot().visible === true, "a player's client shows what a GM sent it");
onSocket({ t: "zones", op: "hl", scene: "scene1", set: [{ id: "evil", zones: ["z3"] }] }, "p2");
onSocket({ t: "zones", op: "hl", scene: "other", set: [{ id: "elsewhere", zones: ["z3"] }] }, "gm");
check(api.highlights().length === 1, "a highlight from another player, or for another scene, is not taken");
id = api.highlight({ id: "mine", zones: ["z4"], users: "all" });
check(takeSent().length === 0 && api.highlights().length === 2, "a player's own highlight stays on the player's client, whoever it names");
check(api.clearHighlights() === 1 && api.highlights()[0].id === "fromgm", "clearing without a name takes only what this client made");
onSocket({ t: "zones", op: "hl", scene: "scene1", del: ["fromgm"] }, "gm");
check(api.highlights().length === 0, "the GM takes its highlight back");
game.user = users.get("gm");

// a mover's reach
id = api.showReach("z4", { way: "walk", speed: 1, stress: true });
let hs = api.highlights().find((x) => x.id === "reach");
check(id === "reach" && J(hs.zones.map((e) => [e.zone, e.style, e.label])) === J([["z4", "outline", null], ["z5", "fill", "1"]]) && hs.zones[1].color === 0x5cc8ff, "showReach: the mover's zone outlined, what one action reaches in the move colour with its distance (walls stop it)");
api.showReach("z4", { way: "air", speed: 1, stress: true }, { beyond: true });
hs = api.highlights().find((x) => x.id === "reach");
check(hs.zones.find((e) => e.zone === "z3")?.color === 0x5cc8ff && hs.zones.find((e) => e.zone === "z2") === undefined && api.highlights().length === 1, "a flyer passes the exterior wall; the same id replaces the old picture");
api.clearHighlights("reach");

/* ================================================================ wired: picking */

const click = (x, y, button = 0) => { view.fire("pointerdown", { button, clientX: x, clientY: y }); window.fire("pointerup", { button, clientX: x, clientY: y, target: view }); };
let pr = api.pick({ zones: ["z2", { spot: "z3:elevated", label: "2", tip: "with stress" }], title: "Where to?" });
check(api.picking() === true && document.body.classList.contains("mm-z-picking") && els.some((e) => e.className === "mm-z-pick" && e.innerHTML.includes("Where to?")), "a pick shows its banner");
calls.length = 0;
view.fire("pointermove", { clientX: 500, clientY: 100 });
check(document.body.classList.contains("mm-z-pick-ok") && calls.some((c) => c[0] === "lineStyle" && c[1].color === 0xffffff) && els.some((e) => e.className.includes("mm-z-pick-tip") && e.innerHTML.includes("with stress")), "hovering a zone on offer: it lights up, the cursor says yes, the tip names it");
view.fire("pointermove", { clientX: 900, clientY: 100 });
check(document.body.classList.contains("mm-z-pick-no") && !document.body.classList.contains("mm-z-pick-ok"), "hovering another zone: the cursor says no");
click(900, 100);
check(api.picking() === true, "a click on a zone that is not on offer picks nothing");
view.fire("pointerdown", { button: 0, clientX: 500, clientY: 100 }); window.fire("pointerup", { button: 0, clientX: 560, clientY: 100, target: view });
check(api.picking() === true, "a drag is not a click");
click(500, 100);
let res = await pr;
check(res.ok === true && res.zone === "z3" && res.spot === "z3:elevated" && res.place.level === "elevated" && res.place.roof === true && res.x === 500 && res.id === 2, "a click on a zone on offer: the place the entry named (the rooftop of the building)");
check(api.picking() === false && !document.body.classList.contains("mm-z-picking") && els.filter((e) => e.className === "mm-z-pick").every((e) => e.gone) && view.ls.get("pointerdown").length === (game.user.isGM ? 1 : 0), "the pick is over: banner, cursor and listeners are gone (the editor's own stay)");
pr = api.pick();
window.fire("keydown", { key: "Escape" });
check((await pr).reason === "cancelled", "any zone can be picked when none is listed; Escape gives it up");
pr = api.pick({ zones: ["z1"] });
click(100, 100, 2);
check((await pr).reason === "cancelled", "a right-click gives it up");
pr = api.pick({ zones: ["z1"] });
const pr2 = api.pick({ zones: ["z5"] });
check((await pr).reason === "replaced" && api.picking(), "a new pick replaces a running one");
check(api.cancelPick() === true && (await pr2).reason === "cancelled" && api.cancelPick() === false, "cancelPick gives it up");
check((await api.pick({ zones: ["nope"] })).reason === "noZones" && (await api.pick({ zones: [] })).reason === "noZones", "nothing to pick from: refused at once");
pr = api.pick({ zones: ["z1"], timeout: 15 });
check((await pr).reason === "timeout", "a pick with a time limit ends by itself");
pr = api.pick({ zones: ["z1"] });
Hooks.callAll("canvasTearDown");
check((await pr).reason === "sceneChanged", "the scene closes under a pick: it ends");
open(sc); takeSent();

// asked of another user
pr = api.pick({ user: "p1", zones: ["z2", "z3"], title: "Your move" });
out = takeSent();
check(out.length === 1 && J(out[0].to) === J(["p1"]) && out[0].msg.op === "pick" && out[0].msg.pick.title === "Your move" && api.picking() === false, "a pick asked of a player goes to that player alone; the GM's own screen does not pick");
onSocket({ t: "zones", op: "picked", rid: out[0].msg.rid, result: { ok: true, zone: "z9" } }, "p2");
let done = false; pr.then(() => { done = true; });
await tick();
check(done === false, "an answer from somebody else is not taken");
onSocket({ t: "zones", op: "picked", rid: out[0].msg.rid, result: { ok: true, zone: "z3", spot: "z3" } }, "p1");
check((await pr).zone === "z3", "the player's answer resolves the GM's call");
pr = api.pick({ user: "p2", zones: ["z2"] }); takeSent();
Hooks.callAll("userConnected", users.get("p2"), false);
check((await pr).reason === "userGone", "the asked user leaves: the call ends");
users.get("p2").active = false;
check((await api.pick({ user: "p2", zones: ["z2"] })).reason === "userGone", "a user who is not connected is not asked");
users.get("p2").active = true;
// the asked side
game.user = users.get("p1");
check((await api.pick({ user: "p2", zones: ["z2"] })).reason === "notGM", "a player cannot make another user pick");
onSocket({ t: "zones", op: "pick", scene: "scene1", rid: "gm.9", pick: { zones: ["z2"], title: "Go" } }, "p2");
check(api.picking() === false, "a pick request from a player is not taken");
onSocket({ t: "zones", op: "pick", scene: "scene1", rid: "gm.9", pick: { zones: ["z2"], title: "Go" } }, "gm");
check(api.picking() === true, "a GM's request starts a pick on the player's client");
click(300, 100);
await tick();
out = takeSent();
check(out.length === 1 && J(out[0].to) === J(["gm"]) && out[0].msg.op === "picked" && out[0].msg.rid === "gm.9" && out[0].msg.result.zone === "z2" && out[0].msg.result.place.spot === "z2", "the player clicks: the answer goes back to the GM who asked");
onSocket({ t: "zones", op: "pick", scene: "scene1", rid: "gm.10", pick: { zones: ["z2"] } }, "gm");
onSocket({ t: "zones", op: "pickCancel", scene: "scene1", rid: "gm.10" }, "gm");
await tick();
out = takeSent();
check(api.picking() === false && out[0].msg.result.reason === "cancelled", "the GM takes the request back");
onSocket({ t: "zones", op: "pick", scene: "other", rid: "gm.11", pick: { zones: ["z2"] } }, "gm");
check(takeSent()[0].msg.result.reason === "noScene", "asked on a scene the player does not have open: told so");
game.user = users.get("gm");

/* ================================================================ the GM's border editor */

const undoBefore = Zones.canUndo();
check(Zones.editBorder("z1|z2", { wall: { armor: 5 }, door: { armor: 3, state: "sealed" } }) === true && api.borderBetween("z1", "z2").wall.armor === 5 && api.borderBetween("z1", "z2").doorway.state === "sealed" && api.borderBetween("z1", "z2").doorway.armor === 3 && Zones.canUndo() && !undoBefore, "editBorder: the wall's Armor and a door put into it, one undo step");
await api.setBorderState("z1|z2", { wall: { state: "breached" } });
Zones.editBorder([0, 1], { wall: { armor: 6, outer: true } });
let bb = api.borderBetween("z1", "z2");
check(bb.wall.armor === 6 && bb.wall.outer === true && bb.wall.state === "breached" && bb.doorway.armor === 3, "an Armor changed under a breached wall leaves it breached; the door stays");
Zones.editBorder("z1|z2", { door: null });
check(api.borderBetween("z1", "z2").doorway === null, "the door is taken out");
game.users.activeGM = users.get("gm2");
check(Zones.editBorder("z1|z2", { wall: { armor: 2, outer: false } }) === true && api.canWrite() === false, "building is the map maker's: a GM who is not the active one may do it");
let r = await api.setBorderState("z1|z2", { wall: { state: "intact" } });
check(r.ok === false && api.refusalText(r).startsWith("MOINENMAPS.Zones.refused.notActiveGM") && api.refusalText(r).includes("Bo") && api.refusalText("weird").startsWith("MOINENMAPS.Zones.refused.other") && api.activeGmName() === "Bo", "play state is the active GM's: the refusal names who that is");
game.users.activeGM = users.get("gm");
check(Zones.editBorder("z1|z9", { wall: { armor: 2 } }) === false && Zones.editBorder("z4|z5", { door: { state: "breached" } }) === false, "no such border, or a door built breached: refused");
game.user = users.get("p1");
check(Zones.editBorder("z1|z2", { wall: { armor: 9 } }) === false, "a player builds nothing");
game.user = users.get("gm");

/* ================================================================ who runs the rules */

Zones.setZone(3, { fire: 6 });
chats.length = 0; notes.length = 0;
check(api.drivenBy() === null && api.wreckText("office") === "4/+1" && api.wreckText("none") === "—" && api.wreckText("") === "", "no combat module: the map's own wrecking numbers");
let log = await api.fireRound();
check(Array.isArray(log) && log.length >= 1 && chats.length === 1, "no combat module: the fire round rolls and posts, as before");
Zones.setZone(3, { fire: 6 });
chats.length = 0;
const before = J(api.state().m);
check(api.rulesDriver({ id: "invincible-plus-ultra" }) === true && J(api.drivenBy()) === J({ id: "invincible-plus-ultra", title: "Plus Ultra", fireRound: false, distances: true }) && Zones.fireRoundOn() === false, "a combat module takes over without a fire routine: the map's fire buttons go");
log = await api.fireRound();
check(log === null && chats.length === 0 && J(api.state().m) === before && notes.some((n) => n[1].includes("driven.fire") && n[1].includes("Plus Ultra")), "driven: the map rolls, writes and posts nothing, and says who runs the fire");
let ran = 0;
api.rulesDriver({ id: "ipu", title: "IPU", fireRound: async () => { ran++; return "engine"; }, wreck: { office: [5, 2] }, distances: false });
check((await api.fireRound()) === "engine" && ran === 1 && chats.length === 0 && Zones.fireRoundOn() === true, "driven with a fire routine: the button and the call run the driver's");
check(api.wreckText("office") === "5/+2" && api.wreckText("street") === "" && api.zone("z3").wreck.strength === 4, "the numbers beside a terrain are the driver's; api.zone().wreck stays the map's table (data, as before)");
api.rulesDriver({ id: "ipu", wreck: (t) => (t === "office" ? "S4" : null) });
check(api.wreckText("office") === "S4" && api.wreckText("woods") === "", "the driver's numbers as a function");
check(api.rulesDriver(false, "someone-else") === false && api.drivenBy() !== null && api.rulesDriver(false, "ipu") === false && api.drivenBy() === null && api.wreckText("office") === "4/+1", "only the driver in charge steps down by name; then the map's own again");

/* ================================================================ the GM's menus (their content; clicking them needs a browser) */

const Menu = await imp("scripts/zones/menu.mjs");
const has = (s, ...parts) => parts.every((x) => s.includes(x));
let bh = Menu.html("border", { at: { x: 200, y: 100 } });
check(has(bh, 'name="wallNow"', 'name="wallOuter"', 'name="hasDoor"', 'data-act="wallArmor+"') && !bh.includes('name="doorNow"') && !bh.includes("mm-z-menu-lock") && !bh.includes("disabled"), "a wall's menu: its Armor, exterior or not, a door to put in, its state in play");
Zones.editBorder("z1|z2", { door: { state: "locked" } });
await api.setBorderState("z1|z2", { door: { state: "open" } });
bh = Menu.html("border", { at: { x: 200, y: 100 } });
check(has(bh, 'name="doorNow"', 'name="doorBuilt"', 'data-act="doorArmor-"', 'data-act="restoreBorder"') && /<option value="open" selected>/.test(bh) && /<option value="locked" selected>/.test(bh), "with a door: its Armor, the state it is built in and the state it is in now; restoring offered once something happened");
check(!Menu.html("border", { at: { x: 800, y: 100 } }).includes('name="wallNow"') && Menu.html("border", { at: { x: 800, y: 100 } }).includes('data-kind="wall"'), "an open border offers only what to build");
game.users.activeGM = users.get("gm2");
bh = Menu.html("border", { at: { x: 200, y: 100 } });
check(has(bh, "mm-z-menu-lock", "Bo") && /name="wallNow"[^>]* disabled/.test(bh) && /name="doorNow"[^>]* disabled/.test(bh) && !/name="wallOuter"[^>]* disabled/.test(bh) && !/data-act="wallArmor\+"[^>]* disabled/.test(bh), "a GM who is not the active one: play controls off with a line saying whose they are; building stays");
game.users.activeGM = users.get("gm");
await api.restoreBorders("z1|z2");
Zones.setZone(1, { empty: true, tags: ["metal"] });
let zh = Menu.html("zone", { zone: 1, tab: "features" });
check(has(zh, 'name="empty"', 'data-tag="metal"', 'data-tag="bystanders"', 'name="terrain"', 'role="tablist"') && /name="empty"[^>]* checked/.test(zh) && /data-tag="metal"[^>]*aria-pressed="true"/.test(zh) && /data-tag="power"[^>]*aria-pressed="false"/.test(zh) && has(zh, "4/+1") && !zh.includes("driven.note"), "a zone's page: empty, the resource tags, what wrecking takes (the map's numbers)");
check(J(api.zone("z2").tags) === J(["metal"]) && api.zone("z2").empty === true, "what the menu writes is what the API reports");
api.rulesDriver({ id: "ipu", title: "IPU", wreck: { office: [5, 2] } });
zh = Menu.html("zone", { zone: 1, tab: "features" });
check(has(zh, "5/+2", "driven.note") && !zh.includes("4/+1"), "a combat module runs the rules: its numbers beside the terrains, and a line saying so");
api.rulesDriver(false);
const sm = await api.addZoneState("z2:elevated", { kind: "smoke", level: 2, owner: { name: "Kid Thor" }, ends: "end of scene" });
await api.addZoneState("z2", { kind: "gravity", data: { mode: "high" } });
zh = Menu.html("zone", { zone: 1, tab: "states" });
check(has(zh, `data-rec="${sm.result.id}"`, "reg.kind.smoke", "Kid Thor", "end of scene", 'name="recAt"', 'name="recMode"', 'data-act="recAdd"', 'name="wrecked"') && /<option value="elevated" selected>/.test(zh) && /<option value="high" selected>/.test(zh) && /data-tab="states"[^>]*>[^<]*<em>2<\/em>/.test(zh), "the states page: the quick marks, every tracked state with its level, where it holds, who made it and until when; the tab counts them");
const ed = await api.addEdge({ kind: "portal", a: "z2", b: "z5:elevated" });
zh = Menu.html("zone", { zone: 1, tab: "passages" });
check(has(zh, `data-edge="${ed.result.id}"`, "edge.kind.portal", 'data-act="edgePick"', 'name="edgeKind"') && Menu.spotName("z5:elevated").includes("reg.at.elevated") && Menu.spotName("@dimension").includes("area.dimension"), "the passages page: each passage with its far end, and a way to make one");
game.users.activeGM = users.get("gm2");
zh = Menu.html("zone", { zone: 1, tab: "states" });
check(has(zh, "mm-z-menu-lock") && /data-act="recAdd"[^>]* disabled/.test(zh) && /data-act="recDel"[^>]* disabled/.test(zh) && !/name="wrecked"[^>]* disabled/.test(zh), "tracked states are play state: off for a GM who is not the active one");
game.users.activeGM = users.get("gm");
notes.length = 0;
check(Menu.told({ ok: true }) === true && Menu.told({ ok: false, reason: "notActiveGM" }) === false && notes.length === 1 && notes[0][0] === "warn" && notes[0][1].includes("refused.notActiveGM"), "a refused write is told in a notice");
await api.removeZoneState(sm.result.id); await api.removeEdge(ed.result.id);

/* ================================================================ the words */

// every key the menus, the panel and the pick banner ask for through their own helper (Z / L: the lang audit does not follow those)
// is there in both languages; a key with ${...} in it is a family and needs at least one member
{
  const fs = await import("node:fs");
  const en = JSON.parse(fs.readFileSync(path.join(root, "lang/en.json"), "utf8")), pl = JSON.parse(fs.readFileSync(path.join(root, "lang/pl.json"), "utf8"));
  const missing = [];
  for ( const f of ["menu", "interact", "play-panel", "section"] ) {
    const src = fs.readFileSync(path.join(root, `scripts/zones/${f}.mjs`), "utf8");
    for ( const m of src.matchAll(/\b[ZL]\((?:"([^"]+)"|`([^`]+)`)/g) ) {
      const parts = (m[1] ?? m[2]).split(/\$\{[^}]*\}/), full = `MOINENMAPS.Zones.${parts[0]}`;
      const has = (j) => (parts.length === 1 ? full in j : Object.keys(j).some((k) => k.startsWith(full) && k.endsWith(parts[parts.length - 1])));
      if ( !has(en) ) missing.push(`en ${f}: ${m[1] ?? m[2]}`);
      if ( !has(pl) ) missing.push(`pl ${f}: ${m[1] ?? m[2]}`);
    }
  }
  check(missing.length === 0, `every string of the menus, the panel and the pick banner is there in English and Polish${missing.length ? `: ${missing.join("; ")}` : ""}`);
  const vars = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();
  const odd = Object.keys(en).filter((k) => k.startsWith("MOINENMAPS.Zones.") && k in pl && vars(en[k]) !== vars(pl[k]));
  check(odd.length === 0, `the two languages fill in the same things${odd.length ? `: ${odd.join(", ")}` : ""}`);
}

console.log(failed ? `${failed} failed` : "all zones interact checks passed");
process.exit(failed ? 1 : 0);
