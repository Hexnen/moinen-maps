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
const gv = await api.addZoneState("z2", { kind: "gravity", data: { mode: "high" } });
zh = Menu.html("zone", { zone: 1, tab: "states" });
const steppers = (h) => (h.match(/data-act="recLevel\+"/g) ?? []).length;
check(steppers(zh) === 1 && has(zh, `data-rec="${gv.result.id}"`), "gravity is said by its mode: its record shows no empty level stepper (the smoke's level keeps its own)");
await api.updateZoneState(gv.result.id, { level: 3 });
check(steppers(Menu.html("zone", { zone: 1, tab: "states" })) === 2, "a gravity state that was given a level shows it");
await api.updateZoneState(gv.result.id, { level: null });
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

/* ================================================================ the look: labels that can be read, passages on the map, thin bands far out */

{
  const Place = await imp("scripts/zones/place.mjs");
  // the pure part
  const tok = { x0: 90, y0: 40, x1: 110, y1: 60, w: 3 };
  const spots = [{ dx: 0, dy: 0 }, { dx: 0, dy: -30 }, { dx: 40, dy: 0 }];
  check(Place.pickSpot({ x: 100, y: 50 }, { w: 15, h: 10 }, spots, []) === 0 && Place.pickSpot({ x: 100, y: 50 }, { w: 15, h: 10 }, spots, [tok]) === 1, "a label takes its first spot when nothing is there, the next free one when a token stands on it");
  check(Place.pickSpot({ x: 100, y: 50 }, { w: 15, h: 10 }, spots, [], null, 2) === 2 && Place.pickSpot({ x: 100, y: 50 }, { w: 15, h: 10 }, spots, [{ x0: 125, y0: 40, x1: 160, y1: 60, w: 3 }], null, 2) === 0, "it keeps the spot it has while that is as good as free (no hopping), and leaves it when something comes to stand there");
  check(Place.pickSpot({ x: 100, y: 50 }, { w: 15, h: 10 }, spots, [tok], (x, y) => y > 30) === 2, "a spot out of the label's own zone is taken last");
  check(Place.zoneSpots(30, 0)[0].dy === 0 && Place.zoneSpots(30, 20)[0].dy === -34 && Place.zoneSpots(30, 20, 45)[1].dy === 59 && Place.zoneSpots(30, 20).every((c) => Math.abs(c.dx) >= 43 || Math.abs(c.dy) >= 34), "a zone's label: on the middle when nothing sits there, else around the badge and under the icons - never on them");
  const bs = Place.borderSpots(40, { x: 0, y: 1 });
  check(bs[0].dx === 0 && bs[0].dy === 0 && Math.abs(bs[1].dx) === 26 && bs[1].dy === 0 && bs[3].dx === 0 && Math.abs(bs[3].dy) === 50, "a border's label: on the line, then beside it, then along it");
  const mid = { 0: { x: 100, y: 0 }, 1: { x: 300, y: 0 }, 2: { x: 500, y: 0 } };
  const pm = Place.passageMarks([{ id: "e1", kind: "portal", a: "z1", b: "z3:elevated" }, { id: "e2", kind: "tunnel", a: "z3", b: "z1" }, { id: "e3", kind: "portal", a: "z2", b: "@dimension" }, { id: "e4", kind: "portal", a: "z9", b: "@sky" }, { id: "e5", kind: "tunnel", a: "z2:f1", b: "z2" }],
    (k) => ({ z1: 0, z2: 1, z3: 2 })[k] ?? -1, (id) => mid[id]);
  check(J(pm.map((p) => [p.id, p.joined, p.ends.map((e) => [e.zone, e.side, e.slot])])) === J([["e1", true, [[0, 1, 0], [2, -1, 0]]], ["e2", true, [[2, -1, 1], [0, 1, 1]]], ["e3", false, [[1, 1, 0]]], ["e5", false, [[1, 1, 1]]]]) && pm[0].ends[0].far === "z3:elevated",
    "passages: a mark in each zone they join, on the side of the other end, one after another; one mark where the other end is off the map or in the same zone; none for a passage with no end on the map");
  check(J(Place.markOffsets([{ side: 1, slot: 0 }, { side: 1, slot: 1 }, { side: -1, slot: 0 }], 20)) === J([39, 67, -39]) && J(Place.markOffsets([{ side: 1, slot: 0 }, { side: -1, slot: 0 }], 0)) === J([14, -14]) && J(Place.markOffsets([{ side: 1, slot: 0 }], 0)) === J([0]), "the marks stand beside the badge; in one row across the middle where nothing sits there");
  check(J(Place.markOffsets([{ side: -1, slot: 0 }, { side: 1, slot: 0 }], 20, 12, 4, true)) === J([39, 67]) && J(Place.markOffsets([{ side: -1, slot: 0 }, { side: 1, slot: 0 }], 0, 12, 4, true)) === J([0, 28]), "beside a badge in the zone's corner they all stand to its right");
  check(Place.thin(200) === 1 && Place.thin(32) === 0.5 && Place.thin(3) === 0.4 && Place.thin(200, 18) === 0.55 && Place.thin(200, 9) === 0.55 && Place.thin(48, 27) === 0.5625 && Place.thin(200, 40) === 1, "a band thins with the room its zone has on screen and with how far out the map is seen, down to a floor");
  const big = { x0: 40, y0: 0, x1: 160, y1: 100 };
  const around = Place.spotsAround({ x: 100, y: 50 }, { w: 15, h: 10 }, [big, { x0: 900, y0: 900, x1: 950, y1: 950 }], 80);
  check(around.length === 4 && J(around[0]) === J({ dx: 0, dy: -64 }) && J(around[2]) === J({ dx: 79, dy: 0 }) && Place.pickSpot({ x: 100, y: 50 }, { w: 15, h: 10 }, [...spots, ...around], [{ ...big, w: 3 }]) === 3, "a token bigger than the label's own steps: the label goes just outside it");
  check(Place.pickSpot({ x: 100, y: 50 }, { w: 15, h: 10 }, spots, [], null, { dx: 40, dy: 0 }) === 2 && Place.pickSpot({ x: 100, y: 50 }, { w: 15, h: 10 }, spots, [], null, { dx: 77, dy: 0 }) === 0, "the spot it has may be named by its offset; one that is no longer on offer is forgotten");

  // wired: a label and the tokens
  const dispRoot = () => canvas.primary.children.find((c) => c.sortLayer === 258 && c.sort === 0);
  const labels = () => layerRoot().children[4].children;
  const g3 = Zones.zones().zones.find((z) => z.id === 2).label;
  api.highlight({ id: "lab", zones: [{ zone: "z3", label: "2" }], borders: [{ border: "z4|z5", label: "Armor 2", color: "danger" }] });
  const zl = () => labels().find((c) => c.children[1].text === "2"), bl = () => labels().find((c) => c.children[1].text === "Armor 2");
  const at0 = { x: zl().position.x, y: zl().position.y };
  check(Math.abs(at0.x - g3.x) < 1e-6 && at0.y < g3.y - 19 && Math.abs(bl().position.x - 800) < 1e-6, "a zone's label sits above its number badge, a border's label on the border");
  const boxOf = (c, w) => ({ x0: c.position.x - w / 2, x1: c.position.x + w / 2, y0: c.position.y - 10.5, y1: c.position.y + 10.5 });
  const hits = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  // a token comes to stand on the label, another on the border's label
  const tk = (x, y) => ({ visible: true, document: { x, y, width: 1, height: 1, parent: sc } });
  canvas.tokens.placeables = [tk(at0.x - 50, at0.y - 50), tk(750, 50)];
  Hooks.callAll("updateToken", canvas.tokens.placeables[0].document, { x: 1 });
  await tick(90);
  const tb = (t) => ({ x0: t.document.x, y0: t.document.y, x1: t.document.x + 100, y1: t.document.y + 100 });
  check(!hits(boxOf(zl(), 22), tb(canvas.tokens.placeables[0])) && Zones.zonesApi.zoneAt(zl().position.x, zl().position.y) === 2, "a token comes to stand on a zone's label: the label steps aside, still in its zone");
  check(!hits(boxOf(bl(), bl().children[1].width + 14), tb(canvas.tokens.placeables[1])), "a border's label steps off a token too");
  check(!Zones.displayBoxes().filter((b) => b.zone === 2).some((b) => hits(boxOf(zl(), 22), b)), "... and not onto the zone's badge or icons");
  const moved = { x: zl().position.x, y: zl().position.y };
  canvas.tokens.placeables[0].visible = false;                      // (a token this user does not see hides nothing)
  Hooks.callAll("updateToken", canvas.tokens.placeables[0].document, { hidden: true });
  Hooks.callAll("updateToken", canvas.tokens.placeables[0].document, { name: "x" });
  await tick(90);
  check(zl().position.y === moved.y && zl().position.x === moved.x, "the token is gone from sight: the label stays where it is (it does not hop back)");
  canvas.tokens.placeables = [];
  calls.length = 0;
  Hooks.callAll("deleteToken", { parent: sc });
  await tick(90);
  check(calls.filter((c) => c[0] === "beginFill").length === 0, "placing labels draws nothing again");
  api.clearHighlights();

  // far zoomed out the bands thin
  const bandW = () => Math.max(...calls.filter((c) => c[0] === "lineStyle" && c[1].color === 0x5cc8ff && c[1].alpha === 1).map((c) => c[1].width * canvas.stage.scale.x));
  calls.length = 0;
  api.highlight({ id: "far", zones: ["z3"] });
  const near = bandW();
  calls.length = 0;
  canvas.stage.scale.x = 0.1; for ( const fn of canvas.app.ticker.fns ) fn();
  const far = bandW();
  check(near === 7.5 && far < near * 0.5 && far >= near * 0.4 - 1e-9, "a zone small on screen gets a thinner band (the same band at a normal zoom)");
  canvas.stage.scale.x = 1; for ( const fn of canvas.app.ticker.fns ) fn();
  api.clearHighlights();

  // passages on the map
  const marks = () => dispRoot().children[7].children.filter((c) => c.children?.[0]?.mmKey === "passage");
  check(marks().length === 0 && Zones.displayBoxes().every((b) => b.kind !== "pass"), "no passage: no mark");
  calls.length = 0;
  const e1 = await api.addEdge({ kind: "portal", a: "z2", b: "z5:elevated" });
  const z2 = Zones.zones().zones.find((z) => z.id === 1).label, z5 = Zones.zones().zones.find((z) => z.id === 4).label;
  let mk = marks();
  check(mk.length === 2 && mk[0].position.x > z2.x + 19 && mk[0].position.y === z2.y && mk[1].position.x < z5.x - 19 && calls.some((c) => c[0] === "lineStyle" && c[1].color === 0xc9a2ff) && Zones.displayBoxes().filter((b) => b.kind === "pass").map((b) => b.zone).join() === "1,4",
    "a portal: a mark beside the badge of each zone it joins, each on the side of the other, and a line between them");
  calls.length = 0;
  const e2 = await api.addEdge({ kind: "tunnel", a: "z2", b: "@dimension" });
  mk = marks();
  check(mk.length === 3 && mk[2].position.x > mk[0].position.x + 22 && !calls.some((c) => c[0] === "lineStyle" && c[1].color === 0xdcbb8c && c[1].alpha !== 1), "a passage that leaves the map: one mark, next in the row, and no line");
  game.user = users.get("p1");
  Zones.refresh();
  check(marks().length === 3 && dispRoot().visible === true, "a player who sees the zones sees the passages");
  game.user = users.get("gm");
  Zones.refresh();
  api.highlight({ id: "lab2", zones: [{ zone: "z2", label: "1" }] });
  const l2 = labels().find((c) => c.children[1].text === "1");
  check(!Zones.displayBoxes().filter((b) => b.zone === 1).some((b) => hits(boxOf(l2, 22), b)), "a label keeps clear of the passages' marks");
  api.clearHighlights();
  await api.removeEdge(e1.result.id); await api.removeEdge(e2.result.id);
  check(marks().length === 0, "the passages are removed: their marks go");
}

/* ================================================================ names, and the free part of the screen */

{
  game.user = users.get("gm");
  open(makeScene(JSON.parse(J(flag)), [["t1", 0, 0]]));
  takeSent();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- a zone's name as its badge shows it
  check(api.zoneName("z3") === "3" && api.zoneName(2) === "3" && api.zoneName("z3:f2") === "3" && api.zoneName(scene.tokens[0]) === "1" && api.zoneName({ x: 900, y: 100 }) === "5" && api.zoneName("zz") === null && api.zoneName("@sky") === null && api.zoneName(null) === null,
    "zoneName: the number on the badge, for a key, an id, a spot, a token or a point; nothing for what names no zone");
  check(api.numberFormat() === "arabic" && api.numeral(14) === "14" && api.numeral(14, "roman") === "XIV" && api.numeral(3, "letters") === "C" && api.numeral(7, "padded") === "07" && api.numeral(0) === null && api.numeral("x") === null && api.NUM_FORMATS.includes("roman"),
    "numberFormat and numeral: the format in force, any number in it or in a named format");
  check(api.zoneTitle("z3") === `MOINENMAPS.Zones.zone.title${J({ n: "3" })}` && api.zoneTitle("z3:elevated") === api.zoneTitle("z3") && api.zoneTitle("z3:elevated", { level: true }).startsWith("MOINENMAPS.Zones.place.at") && api.zoneTitle("z3:elevated", { level: true }).includes("place.roof")
    && api.zoneTitle("z1:elevated", { level: true }).includes("place.air") && api.zoneTitle("z1:underground", { level: true }).includes("place.underground") && api.zoneTitle("@orbit") === "MOINENMAPS.Zones.place.orbit" && api.zoneTitle("zz") === null,
    "zoneTitle: the zone in words, with its level on request; an off-map area by its name");
  api.setParams({ lookFrom: "custom", look: { numFormat: "roman" } });
  check(api.numberFormat() === "roman" && api.zoneName("z4") === "IV" && api.zoneTitle("z4").includes(J({ n: "IV" })) && api.numeral(9) === "IX", `another numeral format on the map: the names follow it (${api.numberFormat()}, ${api.zoneName("z4")})`);
  api.setParams({ look: { numFormat: "arabic" } });

  // ---- a window of 1000 x 600 with a tracker at the top middle and a dock along the bottom; the view maps scene to screen
  globalThis.innerWidth = 1000; globalThis.innerHeight = 600;
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 4); globalThis.cancelAnimationFrame = (t) => clearTimeout(t);
  globalThis.getComputedStyle = (e) => ({ visibility: e.hidden ? "hidden" : "visible", display: "block" });
  const cam = canvas.stage = { pivot: { x: 500, y: 100 }, position: { x: 500, y: 300 }, scale: { x: 1 } };
  canvas.clientCoordinatesFromCanvas = (p) => ({ x: (p.x - cam.pivot.x) * cam.scale.x + cam.position.x, y: (p.y - cam.pivot.y) * cam.scale.x + cam.position.y });
  canvas.canvasCoordinatesFromClient = (p) => ({ x: (p.x - cam.position.x) / cam.scale.x + cam.pivot.x, y: (p.y - cam.position.y) / cam.scale.x + cam.pivot.y });
  let pans = 0;
  canvas.pan = (o) => { if ( o.x != null ) cam.pivot.x = o.x; if ( o.y != null ) cam.pivot.y = o.y; if ( o.scale != null ) cam.scale.x = o.scale; pans++; Hooks.callAll("canvasPan", canvas, o); };
  canvas.animatePan = async (o) => canvas.pan(o);
  const part = (id, x0, y0, x1, y1) => ({ id, hidden: false, parentElement: document.body, classList: { contains: () => false }, closest: () => null, getBoundingClientRect: () => ({ left: x0, top: y0, right: x1, bottom: y1, width: x1 - x0, height: y1 - y0 }), box: [x0, y0, x1, y1] });
  const parts = [part("tracker", 300, 0, 700, 120), part("dock", 0, 400, 1000, 600)];
  const hitAt = (x, y) => parts.find((p) => x >= p.box[0] && x < p.box[2] && y >= p.box[1] && y < p.box[3]) ?? view;
  document.elementFromPoint = hitAt;
  document.elementsFromPoint = (x, y) => { const e = hitAt(x, y); return e === view ? [view] : [e, view]; };
  document.documentElement = {};
  const made = [];
  document.createElement = () => {
    const e = makeEl(); e.dataset = {};
    e.getBoundingClientRect = () => { const pick = e.className === "mm-z-pick", top = parseFloat(e.style.top) || 72, left = pick ? 350 : parseFloat(e.style.left) || 0, w = pick ? 300 : 60, h = pick ? 50 : 30; return { left, top, right: left + w, bottom: top + h, width: w, height: h }; };
    e.closest = (sel) => (sel.includes("mm-z-pickway") && e.className.includes("mm-z-pickway") ? e : null);
    made.push(e); return e;
  };
  const banner = () => made.filter((e) => e.className === "mm-z-pick" && !e.gone).pop() ?? null;
  const chips = () => made.filter((e) => e.className.includes("mm-z-pickway") && !e.gone);
  const all5 = ["z1", "z2", "z3", "z4", "z5"];
  const under = async () => { canvas.pan({ x: 500, y: -100, scale: 1 }); await wait(220); };          // every zone lies under the dock

  check(J(api.safeArea()) === J({ x: 0, y: 120, width: 1000, height: 280 }) && J(api.safeArea({ measure: false })) === J({ x: 0, y: 0, width: 1000, height: 600 }) && J(api.uiInsets()) === J({ top: 0, right: 0, bottom: 0, left: 0 }),
    `safeArea: found by looking - the band between the tracker and the dock (${J(api.safeArea())}); nothing declared: the window`);
  const offDock = api.uiInset("t.dock", { bottom: 250 });
  check(api.uiInsets().bottom === 250 && J(api.safeArea({ measure: false })) === J({ x: 0, y: 0, width: 1000, height: 350 }) && J(api.safeArea()) === J({ x: 0, y: 120, width: 1000, height: 230 }) && api.safeArea({ inset: { top: 200 } }).y === 200, "a declared inset cuts the free stretch, with what is found by looking and with one given for the call");
  api.uiInset("t.el", { bottom: parts[1], top: () => 30 }); api.uiInset("t.fn", () => ({ left: 80 }));
  check(J(api.uiInsets({ right: 20 })) === J({ top: 30, right: 20, bottom: 250, left: 80 }), "an inset may be an element (measured), a function, or a function giving all of it; on one side the largest counts");
  offDock();
  parts[1].hidden = true;
  check(api.uiInsets().bottom === 0, "an element that is not shown covers nothing");
  parts[1].hidden = false;
  check(api.uiInsets().bottom === 200, "... and what it covers when it is");
  api.uiInset("t.el", null); api.uiInset("t.fn", null); api.uiInset("", { top: 5 });
  check(J(api.uiInsets()) === J({ top: 0, right: 0, bottom: 0, left: 0 }), "insets are taken back by name");

  // ---- the banner keeps clear of the tracker; nothing hidden: no chip, the view is left alone
  let p0 = pans, pk = api.pick({ zones: all5, title: "Where to?" });
  check(banner()?.style.top === "128px" && chips().length === 0 && pans === p0, `the banner sits below the tracker it would lie on (${banner()?.style.top}); every zone in reach: no chip, no move`);
  // ---- a bar that lets clicks through (a player's tracker): no point finds it, the banner still keeps clear of what it draws
  {
    const gcs0 = globalThis.getComputedStyle, kid = (o) => ({ classList: { contains: () => false }, closest: () => null, children: [], childNodes: [], ...o });
    const box = (x0, y0, x1, y1) => () => ({ left: x0, top: y0, right: x1, bottom: y1, width: x1 - x0, height: y1 - y0 });
    const strip = kid({ tagName: "DIV", css: { pointerEvents: "none", backgroundColor: "rgb(10, 20, 40)" }, getBoundingClientRect: box(380, 120, 640, 150) });
    const tint = kid({ tagName: "DIV", css: { pointerEvents: "none", backgroundColor: "rgba(255, 0, 0, 0.2)" }, getBoundingClientRect: box(0, 0, 1000, 600) });
    const wrap = kid({ tagName: "DIV", css: { pointerEvents: "none", backgroundColor: "rgba(0, 0, 0, 0)" }, getBoundingClientRect: box(300, 0, 700, 150), children: [strip] });
    globalThis.getComputedStyle = (e) => ({ visibility: e.hidden ? "hidden" : "visible", display: "block", opacity: "1", pointerEvents: "auto", backgroundColor: "rgba(0, 0, 0, 0)", backgroundImage: "none", borderTopWidth: "0px", borderBottomWidth: "0px", ...(e.css ?? {}) });
    document.body.children = [wrap, tint];
    api.uiInset("t.again", null); await wait(20);
    const sunk = banner()?.style.top;
    strip.hidden = true;
    api.uiInset("t.again", null); await wait(20);
    check(sunk === "158px" && banner()?.style.top === "128px", `a drawn piece that lets clicks through pushes the banner down; an empty wrapper and a whole-window tint do not (${sunk}, then ${banner()?.style.top})`);
    delete document.body.children; globalThis.getComputedStyle = gcs0;
  }
  // ---- an inset declared while the pick runs: the banner moves at once, and back when it is taken
  {
    const offTop = api.uiInset("t.top", { top: 200 });
    await wait(20);
    const moved = banner()?.style.top;
    offTop();
    await wait(20);
    check(moved === "208px" && banner()?.style.top === "128px", `an inset declared during a pick lays it out again (${moved}, then ${banner()?.style.top})`);
  }
  // ---- the zones go under the dock: one chip at the bottom edge of the free stretch, with their number
  await under();
  let cs = chips();
  check(cs.length === 1 && cs[0].className === "mm-z-pickway mm-z-pickway-bottom" && cs[0].dataset.n === "5" && cs[0].style.top === "392px" && cs[0].style.left === "500px" && cs[0].innerHTML.includes("pick.more") && cs[0].innerHTML.includes("fa-chevron-down") && cs[0].dataset.tooltip.includes("pick.way.bottom"),
    `zones no click can reach are counted on a chip at the edge they lie beyond (${cs.map((c) => [c.className, c.dataset.n, c.style.left, c.style.top])})`);
  // ---- a click on the chip brings the nearest of them into the free stretch
  p0 = pans;
  cs[0].fire("click");
  await wait(120);
  check(cam.pivot.y === 56 && cam.pivot.x === 500 && pans === p0 + 1 && chips().length === 0 && cs[0].gone === true, `a click on the chip slides the view by the least that brings the nearest in (pivot y ${cam.pivot.y}); the chip goes`);
  // ---- resting the pointer at that edge slides the map after a moment
  await under();
  view.fire("pointermove", { clientX: 800, clientY: 380 });
  await wait(250);
  const early = cam.pivot.y;
  await wait(1500);
  const slid = cam.pivot.y;
  await wait(300);
  check(early === -100 && slid > -100 && slid < 60 && chips().length === 0 && cam.pivot.y === slid, `the pointer rests at the edge: nothing at first, then the map slides until nothing is hidden there, and stops (${early} -> ${slid})`);
  const c3 = canvas.clientCoordinatesFromCanvas(api.zone("z3").center);
  click(c3.x, c3.y);
  check((await pk).ok === true && chips().length === 0 && banner() === null, "the pick ends: the banner and the chips are gone");

  // ---- nothing on offer in reach when a pick starts: the nearest comes into view
  await under();
  pk = api.pick({ zones: ["z2", "z3"] });
  await wait(120);
  check(cam.pivot.y === 56 && chips().length === 0, `a pick that starts with nothing in reach brings the nearest zone into view (pivot y ${cam.pivot.y})`);
  api.cancelPick(); await pk;
  // ---- reveal: false leaves the view and shows no chip; edgePan: false keeps the chip and does not slide
  await under();
  pk = api.pick({ zones: all5, reveal: false });
  view.fire("pointermove", { clientX: 800, clientY: 380 });
  await wait(900);
  check(cam.pivot.y === -100 && chips().length === 0, "reveal: false - no chip, the view is left alone");
  api.cancelPick(); await pk;
  canvas.pan({ x: 500, y: -70, scale: 1 }); await wait(50);          // some zones' edges show: the pick starts without moving
  pk = api.pick({ zones: all5, edgePan: false });
  await under();
  view.fire("pointermove", { clientX: 800, clientY: 380 });
  await wait(900);
  check(cam.pivot.y === -100 && chips().length === 1, "edgePan: false - the chip is there, resting at the edge does not slide the map");
  api.cancelPick(); await pk;
  // ---- reveal: "fit" moves - and zooms out - so that everything on offer is in reach
  canvas.pan({ x: 500, y: 100, scale: 2 }); await wait(50);
  pk = api.pick({ zones: all5, reveal: "fit" });
  await wait(320);
  const safe = api.safeArea(), pts = all5.map((k) => canvas.clientCoordinatesFromCanvas(api.zone(k).center));
  check(cam.scale.x < 2 && pts.every((q) => q.x >= safe.x && q.x <= safe.x + safe.width && q.y >= safe.y && q.y <= safe.y + safe.height) && chips().length === 0, `reveal: "fit" - the view zooms out and moves until every zone on offer is in the free stretch (scale ${cam.scale.x.toFixed(2)})`);
  api.cancelPick(); await pk;
  // ---- an inset for one pick; the options of a pick asked of another user
  canvas.pan({ x: 500, y: 100, scale: 1 }); await wait(50);
  pk = api.pick({ zones: ["z1"], inset: { top: 200 } });
  check(banner()?.style.top === "208px", `an inset given with the pick: the banner goes under it (${banner()?.style.top})`);
  api.cancelPick(); await pk;
  takeSent();
  const asked = api.pick({ user: "p1", zones: ["z2"], reveal: "fit", edgePan: false, inset: { bottom: 100, left: -4 } });
  const msg = takeSent()[0].msg;
  check(msg.pick.reveal === "fit" && msg.pick.edgePan === false && J(msg.pick.inset) === J({ top: 0, right: 0, bottom: 100, left: 0 }), "a pick asked of another user carries how its zones are brought into view");
  onSocket({ t: "zones", op: "picked", rid: msg.rid, result: { ok: false, reason: "cancelled" } }, "p1"); await asked;
  let cp = HL.cleanPick({ zones: ["z1"] });
  check(cp.reveal === true && cp.edgePan === true && cp.inset === null && HL.cleanPick({ reveal: "fit", edgePan: 0, inset: { top: 9 } }).reveal === "fit" && HL.cleanPick({ reveal: false }).reveal === false && HL.cleanPick({ inset: { top: 9 } }).inset.top === 9, "a pick request: reveal and edgePan are on unless said otherwise");
  // ---- reveal() on its own
  p0 = pans;
  let rv = await api.reveal("z3");
  check(rv.ok && rv.moved === false && pans === p0 && (await api.reveal("zz")).reason === "noZones" && (await api.reveal([])).reason === "noZones", "reveal: a zone already in the free stretch moves nothing; no zone named: refused");
  canvas.pan({ x: 2000, y: 100, scale: 1 });
  rv = await api.reveal(["z5", "z4"], { animate: false });
  const q5 = canvas.clientCoordinatesFromCanvas(api.zone("z5").center), q4 = canvas.clientCoordinatesFromCanvas(api.zone("z4").center);
  check(rv.ok && rv.moved && q5.x >= 56 && q4.x >= 56 && q5.x <= 944 && cam.scale.x === 1, `reveal: several zones that fit are brought in together, by the least (z4 at ${q4.x}, z5 at ${q5.x})`);
  canvas.pan({ x: 500, y: 100, scale: 4 });
  rv = await api.reveal(["z5", "z1"], { animate: false });
  const q1 = canvas.clientCoordinatesFromCanvas(api.zone("z1").center);
  check(rv.moved && cam.scale.x === 4 && canvas.clientCoordinatesFromCanvas(api.zone("z5").center).x <= 944 && q1.x < 0, "several that do not fit, without `fit`: the first is brought in, the zoom is left alone");
  rv = await api.reveal(["z5", "z1"], { animate: false, fit: true });
  check(rv.moved && cam.scale.x < 4 && canvas.clientCoordinatesFromCanvas(api.zone("z1").center).x >= 56 - 1e-6 && canvas.clientCoordinatesFromCanvas(api.zone("z5").center).x <= 944 + 1e-6, `with \`fit\`: zoomed out until both are in (scale ${cam.scale.x.toFixed(2)})`);
  canvas.pan({ x: 500, y: 100, scale: 1 });
  globalThis.requestAnimationFrame = (fn) => { fn(); return 0; }; globalThis.cancelAnimationFrame = () => {};
}

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
