// Zones, interaction on the map (scripts/zones/board-core.mjs, board.mjs, board-layer.mjs; dev/zones-api.md 25-33): marks on tokens,
// lines between tokens, a move and an area under the pointer, warnings, a menu at a thing, a right click sensed, a player's intention
// for the GMs, one language of zones - who is sent what, what a player is never sent, what each client draws. With the stand-in
// Foundry and recording PIXI of zones-interact.test.mjs (what is drawn is counted, not looked at).   node dev/zones-board.test.mjs
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
  constructor() { this.children = []; this.visible = true; this.destroyed = false; this.scale = { x: 1, set: (v) => { this.scale.x = v; } }; this.position = { x: 0, y: 0, set: (x, y) => { this.position.x = x; this.position.y = y; } }; this.anchor = { set() {} }; this.pivot = { x: 0, y: 0 }; }
  addChild(...c) { this.children.push(...c); return c[0]; }
  removeChildren() { const c = this.children; this.children = []; return c; }
  destroy() { this.destroyed = true; }
  getBounds() { return { x: 0, y: 0, width: 0, height: 0 }; }
}
const sprites = [];
const recorder = (kind) => class extends Node {
  constructor(...a) {
    super(); this.kind = kind; if ( kind === "s" ) sprites.push(this); this.args = a; this.texture = a[0]; this.width = 20; this.height = 12;
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
const socketFns = [];
const onSocket = (msg, sender) => { for ( const fn of socketFns ) fn(msg, sender); };   // (every part of the module listens on the one channel)
const users = new Map([["gm", { id: "gm", isGM: true, active: true, name: "Ada" }], ["gm2", { id: "gm2", isGM: true, active: true, name: "Bo" }], ["p1", { id: "p1", isGM: false, active: true, name: "Test Gracz 1" }], ["p2", { id: "p2", isGM: false, active: true, name: "Test Gracz 2" }]]);
globalThis.game = {
  user: users.get("gm"),
  users: { activeGM: users.get("gm"), get: (id) => users.get(id), filter: (fn) => [...users.values()].filter(fn) },
  i18n: { lang: "en", localize: (k) => k, format: (k, d) => `${k}${d ? J(d) : ""}`, has: () => false },
  settings: { register: (m, k, o) => settings.set(k, o.default), get: (m, k) => { if ( !settings.has(k) ) throw new Error(`no setting ${k}`); return settings.get(k); } },
  scenes: { get: () => scene },
  modules: { get: () => ({ title: "Plus Ultra" }) },
  socket: { emit: (ch, msg, o) => sent.push({ msg, to: o?.recipients ?? null }), on: (ch, fn) => { socketFns.push(fn); } }
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

const BC = await imp("scripts/zones/board-core.mjs");
const C = HL.COLORS;

/* ================================================================ the pure part */

check(BC.tokenIdOf("abc123") === "abc123" && BC.tokenIdOf("Scene.s1.Token.tk9") === "tk9" && BC.tokenIdOf({ id: "t1", documentName: "Token" }) === "t1" && BC.tokenIdOf({ document: { id: "t2" } }) === "t2" && BC.tokenIdOf({ token: { id: "t3" } }) === "t3" && BC.tokenIdOf({ token: "t4", state: "in" }) === "t4" && BC.tokenIdOf(5) === null && BC.tokenIdOf("bad id!") === null, "a token is named by id, uuid, Token, TokenDocument or an entry's `token`");
let tm = BC.cleanTokenMarks({ id: "ipu.targets", color: "danger", tokens: [
  { token: "t1", state: "in", label: " 62 % ", tip: "Attack" }, { token: "t2", state: "out", tip: "Out of range: 3 zones" }, { token: "t3", state: "weird", marks: ["broken", { icon: "fa-solid fa-ghost", color: "#00ff00", tip: "Phased" }, null, 5], bar: { max: 6, value: 9, loss: 2, lossMax: 4 } },
  { token: "t4", state: "caught", hover: { label: "-2", bar: { max: 4, value: 3, loss: 2 } } }, { token: "t1", state: "chosen" }, "t5", 7], users: ["p1"], order: 3 });
check(tm.tokens.length === 5 && tm.tokens[0].state === "in" && tm.tokens[0].color === C.danger && tm.tokens[0].label === "62 %" && tm.tokens[1].state === "out" && tm.tokens[1].tip === "Out of range: 3 zones" && tm.tokens[2].state === null && tm.tokens[4].token === "t5" && J(tm.users) === J(["p1"]) && tm.order === 3, "token marks: one entry per token, its state, label and tip; an unknown state is none; the spec's colour is the default");
check(BC.cleanTokenMarks({ tokens: [{ token: "a", state: "out" }, { token: "b", state: "caught" }, { token: "c", state: "in" }] }).tokens.map((e) => e.color).join() === [C.blocked, C.range, C.target].join(), "without a colour: out of reach is grey, caught in an area the area colour, in reach the target colour");
check(tm.tokens[2].marks.length === 2 && tm.tokens[2].marks[0].icon === "broken" && tm.tokens[2].marks[0].color === BC.STATE_MARKS.broken[2] && tm.tokens[2].marks[1].color === 0x00ff00 && tm.tokens[2].marks[1].tip === "Phased", "state chips: a known name with its own colour, or any icon with the caller's colour and tip");
check(J(tm.tokens[2].bar) === J({ max: 6, value: 6, loss: 2, lossMax: 4, gain: 0, color: C.free, text: null }) && tm.tokens[3].hover.label === "-2" && tm.tokens[3].hover.bar.loss === 2 && tm.tokens[3].hover.bar.lossMax === 2, "a bar is held inside its maximum; hover parts are kept apart");
check(BC.cleanBar({ text: "serious" }).max === 0 && BC.cleanBar({ text: "serious" }).text === "serious" && BC.cleanBar({}) === null && BC.cleanBar({ max: 5, value: 2, loss: 9 }).loss === 2, "a bar without numbers is its words alone (an NPC whose numbers stay hidden); a loss is never more than what is there");
check(BC.cleanTokenMarks({ tokens: [] }) === null && BC.cleanTokenMarks({ id: "no good", tokens: ["t1"] }) === null && BC.cleanTokenMarks({ tokens: [{ token: "t1", label: "x".repeat(60) }] }).tokens[0].label.length === BC.BOARD_LIMITS.label, "nothing named or a bad id: no marks; a label is cut to what fits over a token");
check(J(BC.cleanEnd("t1")) === J({ token: "t1" }) && J(BC.cleanEnd("z7")) === J({ zone: "z7" }) && J(BC.cleanEnd("z7:elevated")) === J({ zone: "z7" }) && J(BC.cleanEnd({ zone: "z2", level: "ground" })) === J({ zone: "z2" }) && J(BC.cleanEnd({ x: 10, y: "20" })) === J({ x: 10, y: 20 }) && J(BC.cleanEnd({ id: "tk", x: 5, y: 5, documentName: "Token" })) === J({ token: "tk" }) && BC.cleanEnd(null) === null, "an end of a line: a token, a zone or a point (a token document has x and y too: it is a token)");
let ln = BC.cleanLinks({ id: "ipu.who", from: "t1", to: "t2", label: "Attack" });
check(ln.links.length === 1 && ln.links[0].color === C.danger && ln.links[0].style === "solid" && ln.links[0].head === true && ln.links[0].label === "Attack", "a line: one from / to, the danger colour, an arrow head");
ln = BC.cleanLinks({ id: "many", color: "info", style: "dashed", links: [{ from: "t1", to: { zone: "z3" } }, { to: "t2", head: false }, { from: "t1" }] });
check(ln.links.length === 2 && ln.links[0].style === "dashed" && ln.links[0].color === C.info && ln.links[1].from === null && ln.links[1].head === false && BC.cleanLinks({ links: [{ from: "t1" }] }) === null, "several lines in one set; a line needs a target, not an origin");
const hid = (id) => id === "h1";
let full = BC.cleanTokenMarks({ id: "m", tokens: ["t1", "h1"] });
check(BC.stripForPlayers(full, () => false) === full && J(BC.stripForPlayers(full, hid).tokens.map((e) => e.token)) === J(["t1"]) && BC.stripForPlayers(BC.cleanTokenMarks({ id: "m", tokens: ["h1"] }), hid) === null, "for players: a mark on a token hidden from them is held back (nothing left: nothing sent)");
full = BC.cleanLinks({ id: "l", links: [{ from: "h1", to: "t1" }, { from: "t1", to: "h1" }, { from: "t1", to: "t2" }] });
let lean = BC.stripForPlayers(full, hid);
check(lean.links.length === 2 && lean.links[0].from === null && lean.links[0].to.token === "t1" && lean.links[1].from.token === "t1" && BC.stripForPlayers(BC.cleanLinks({ from: "t1", to: "h1" }), hid) === null, "for players: a line from a hidden token keeps only its target, a line to a hidden token is held back");
let it = BC.cleanIntent({ token: "t1", to: { zone: "z3" }, zones: ["z3", "z3:f1", "z4"], label: "Blast", color: "range", ttl: 999999 });
check(it.token === "t1" && it.to.zone === "z3" && J(it.zones) === J(["z3", "z4"]) && it.label === "Blast" && it.color === C.range && it.ttl === BC.BOARD_LIMITS.intentMax && BC.cleanIntent({}) === null && BC.cleanIntent({ token: "t1" }).ttl === BC.BOARD_LIMITS.intentTtl, "an intention: whose token, what is aimed at, the zones, a label, a time to live (capped)");
let mn = BC.cleanMenu({ title: "Omni-Man", sub: "Zone 3", items: [{ id: "atk", label: "Attack", icon: "fa-solid fa-hand-fist", hint: "62 %" }, { separator: true }, { separator: true }, { label: "Grab", disabled: "Out of reach" }, { id: "hp", label: "Health", stepper: { value: 3, min: 0, max: 5 } }, { id: "held", label: "Held", toggle: true, on: true }, {}, { separator: true }] });
check(mn.title === "Omni-Man" && mn.items.length === 5 && mn.items[1].separator && mn.items[2].id === "i3" && mn.items[2].disabled === "Out of reach" && mn.items[3].stepper.max === 5 && mn.items[4].toggle && mn.items[4].on && mn.items[0].hint === "62 %", "a menu: entries with icon and hint, a reason on a disabled one, steppers and toggles; empty rows and doubled or trailing separators go");
check(BC.cleanMenu({ items: [] }) === null && BC.cleanMenu({ items: [{ separator: true }] }) === null && BC.stepValue({ value: 5, min: 0, max: 5 }, 1) === 5 && BC.stepValue({ value: 5, min: 0, max: 5 }, -1) === 4 && BC.stepValue({ value: 0, min: 0, max: 5 }, -1) === 0, "no entry: no menu; a stepper stays inside its limits");
const mid = { z1: { x: 100, y: 100 }, z2: { x: 300, y: 100 }, z9: { x: 900, y: 100 } };
let runs = BC.routeRuns({ x: 50, y: 50 }, [{ kind: "border", zone: "z2", border: { x: 200, y: 100 } }, { kind: "level", zone: "z2" }, { kind: "edge", zone: "z9" }, { kind: "border", zone: "z8", border: { x: 800, y: 100 } }], { x: 700, y: 100 }, (k) => mid[k]);
check(runs.length === 3 && J(runs[0].pts) === J([50, 50, 200, 100]) && runs[1].jump === true && J(runs[1].pts) === J([200, 100, 900, 100]) && J(runs[2].pts) === J([900, 100, 800, 100, 700, 100]), "a route's line: from the mover through each border crossed to its end; a passage is a run of its own");
check(J(BC.routeRuns({ x: 0, y: 0 }, [], { x: 0, y: 0 }, () => null)) === "[]", "no step: no line");
{
  // where a route crosses a border: where the straight way passes it, else the nearest point of the border to that way
  const wall = [[100, 0, 100, 200]], c1 = BC.crossing({ x: 0, y: 50 }, { x: 200, y: 150 }, wall), c2 = BC.crossing({ x: 0, y: 300 }, { x: 200, y: 300 }, wall);
  check(J(c1) === J({ x: 100, y: 100 }) && J(c2) === J({ x: 100, y: 200 }) && BC.crossing({ x: 0, y: 0 }, { x: 1, y: 1 }, []) === null, "a route crosses a border where the straight way passes it, else at the border's nearest point");
  const two = BC.crossing({ x: 0, y: 10 }, { x: 300, y: 10 }, [[200, 0, 200, 20], [100, 0, 100, 20]]);
  check(J(two) === J({ x: 100, y: 10 }), "of two stretches crossed the first on the way counts");
}
check(J(BC.pullIn(0, 0, 100, 0, 30)) === J([70, 0]) && J(BC.pullIn(0, 0, 10, 0, 30)) === J([5.5, 0]) && BC.bowed(0, 0, 100, 0, 0.1, 4).length === 10 && Math.abs(BC.bowed(0, 0, 100, 0, 0.1, 4)[5] + 5) < 1e-9, "a line stops at a token's rim (never more than under half of it) and bows a little");
check(J(BC.menuSpot({ x0: 100, y0: 100, x1: 160, y1: 160 }, 200, 300, 1000, 600)) === J({ x: 170, y: 100 }) && BC.menuSpot({ x0: 850, y0: 100, x1: 910, y1: 160 }, 200, 300, 1000, 600).x === 640 && BC.menuSpot({ x0: 100, y0: 500, x1: 160, y1: 560 }, 200, 300, 1000, 600).y === 292, "a menu stands right of its thing, left when there is no room, and inside the window");
check(BC.followOf("auto") === "all" && BC.followOf("auto", "turn") === "turn" && BC.followOf("off", "turn") === "off" && BC.followOf("all", "off") === "all" && BC.followOf("nonsense", "nonsense") === "all", "the camera's follow mode: the user's choice, else the combat module's default, else every beat");

/* ================================================================ wired */

// five zones in a row (as zones-interact.test): a wall z1|z2, a locked door z2|z3, an exterior wall z3|z4, z4|z5 open
const flag = {
  v: 1, s: [[1, [200, -20, 200, 220]], [2, [400, -20, 400, 220]], [3, [600, -20, 600, 220]], [4, [800, -20, 800, 220]]], next: 5, preset: null, snap: 0.25, smooth: 0,
  look: { who: "all", lineStyle: "solid" }, w: [[200, 100, "wall"], [400, 100, "locked"], [600, 100, "outer"]], m: [[500, 100, { building: true, terrain: "office" }]]
};
const sc = makeScene(JSON.parse(J(flag)), [["t1", 650, 50], ["t2", 850, 50], ["t3", 450, 50], ["h1", 880, 100]]);
sc.tokens.get = (id) => sc.tokens.find((t) => t.id === id) ?? null;
const tokObjs = () => {
  canvas.tokens.placeables = sc.tokens.map((d) => {
    const t = new Node();
    Object.assign(t, { id: d.id, document: d, x: d.x, y: d.y, w: 100, h: 100, visible: true, controlled: false, mesh: { tint: 0xffffff, destroyed: false } });
    d.object = t; d.sort = 0; d.testUserPermission = (u) => u?.id === "p1" && d.id === "t1";
    return t;
  });
  canvas.clientCoordinatesFromCanvas = (p) => ({ x: p.x, y: p.y });
  canvas.pan = (to) => { pans.push(to); };
  canvas.stage.pivot = { x: 0, y: 0 };
};
const pans = [];
sc.tokens.get("h1").hidden = true;
open(sc); tokObjs(); takeSent();
const T = (id) => sc.tokens.get(id).object;
const boardOf = (id) => T(id)._mmBoard && !T(id)._mmBoard.destroyed ? T(id)._mmBoard : null;

/* ---- marks on tokens */
const pm0 = (view.ls.get("pointermove") ?? []).length;
check(api.markTokens({ tokens: [] }) === null && api.tokenMarks().length === 0 && boardOf("t1") === null, "nothing marked: nothing on the tokens");
let id = api.markTokens({ id: "ipu.targets", tokens: [{ token: "t2", state: "in", label: "62 %", tip: "Attack: 4 dice" }, { token: "t3", state: "out", tip: "Out of range" }] });
check(id === "ipu.targets" && boardOf("t2")?.e.label === "62 %" && boardOf("t2").label && boardOf("t3")?.e.state === "out" && boardOf("t1") === null && sent.length === 0, "markTokens: a ring and a label on the token in reach, on this client only");
check(T("t3").mesh.tint !== 0xffffff && T("t2").mesh.tint === 0xffffff, "a token out of reach is dimmed (its picture tinted), one in reach is not");
T("t3").mesh.tint = 0xffffff; Hooks.callAll("refreshToken", T("t3"));
check(T("t3").mesh.tint !== 0xffffff, "Foundry's refresh sets the tint again: the dimming is put back");
api.markTokens({ id: "ipu.states", tokens: [{ token: "t2", marks: ["held", { icon: "broken", tip: "Broken" }] }, { token: "t1", marks: ["airborne"] }] });
check(boardOf("t2").e.state === "in" && boardOf("t2").e.label === "62 %" && boardOf("t2").chips.length === 2 && boardOf("t1").chips.length === 1 && api.tokenMarks().length === 2, "two sets on one token add up: the reach mark of one, the state chips of the other");
view.fire("pointermove", { clientX: 880, clientY: 80 });
check(els.some((e) => !e.gone && e.className.includes("mm-z-board-tip") && e.innerHTML.includes("Attack: 4 dice") && e.innerHTML.includes("Broken")), "the pointer on a marked token: what the caller said about it and about its states, beside the cursor");
api.markTokens({ id: "ipu.targets", tokens: [{ token: "t2", state: "chosen", label: "62 %", hover: { label: "-2", bar: { max: 5, value: 4, loss: 2 } } }] });
check(boardOf("t2").bar && boardOf("t2").e.hover.bar.loss === 2 && boardOf("t3") === null && T("t3").mesh.tint === 0xffffff, "the same id again replaces the set: the token that left it is as it was; hover parts show while the pointer is on the token");
view.fire("pointermove", { clientX: 20, clientY: 20 });
check(!boardOf("t2").bar && els.filter((e) => e.className.includes("mm-z-board-tip")).every((e) => e.gone), "the pointer leaves: the hover parts and the tip go");
T("t2")._mmBoard.destroy(); Hooks.callAll("drawToken", T("t2"));
check(boardOf("t2")?.e.state === "chosen", "a token drawn again gets its marks back");
check(api.clearTokenMarks({ prefix: "ipu." }) === 2 && boardOf("t2") === null && boardOf("t1") === null && view.ls.get("pointermove").length === pm0, "cleared: nothing on the tokens, the pointer is not watched any more");

// who gets them
takeSent();
api.markTokens({ id: "ipu.t", tokens: [{ token: "t2", state: "in", label: "40 %" }, { token: "h1", state: "in", label: "55 %" }], users: ["p1", "gm2"] });
let out = takeSent();
check(out.length === 2 && J(out.find((m) => m.to.includes("gm2")).msg.set[0].tokens.map((e) => e.token)) === J(["t2", "h1"]) && J(out.find((m) => m.to.includes("p1")).to) === J(["p1"]) && J(out.find((m) => m.to.includes("p1")).msg.set[0].tokens.map((e) => e.token)) === J(["t2"]) && out.every((m) => m.msg.t === "board" && m.msg.op === "tm"), "sent to the named users alone; a mark on a token hidden from players goes to the GM and not to the player");
check(api.tokenMarks().length === 0, "not shown on the sender's own screen unless the sender is named");
api.markTokens({ id: "ipu.t", tokens: [{ token: "h1", state: "in" }], users: ["p1"] });
out = takeSent();
check(out.some((m) => J(m.to) === J(["gm2"]) && J(m.msg.del) === J(["ipu.t"])) && out.some((m) => J(m.to) === J(["p1"]) && J(m.msg.del) === J(["ipu.t"])) && !out.some((m) => m.msg.set), "only a hidden token left for a player: the player's set is taken away, nothing about it is sent");
onSocket({ t: "board", op: "hello", scene: "scene1" }, "p1");
check(takeSent().every((m) => !m.msg.set), "a player who opens the scene later is not sent it either");
api.clearTokenMarks("ipu.t"); takeSent();
api.markTokens({ id: "all", tokens: ["t2"], users: "all" });
out = takeSent();
check(out.length === 1 && out[0].to === null && api.tokenMarks().length === 1, "for all with nothing hidden: one message to everybody, shown here too");
api.clearTokenMarks(); takeSent();
onSocket({ t: "board", op: "tm", scene: "scene1", set: [{ id: "fromgm", tokens: [{ token: "t1", state: "in", label: "1" }] }] }, "gm2");
onSocket({ t: "board", op: "tm", scene: "scene1", set: [{ id: "evil", tokens: ["t2"] }] }, "p2");
onSocket({ t: "board", op: "tm", scene: "other", set: [{ id: "far", tokens: ["t2"] }] }, "gm2");
check(api.tokenMarks().length === 1 && api.tokenMarks()[0].from === "gm2" && boardOf("t1") && !boardOf("t2"), "marks are taken from a GM's client, for this scene, and from nobody else");
check(api.clearTokenMarks() === 0 && api.clearTokenMarks({ all: true }) === 1, "clearing without a name leaves what others showed here; { all: true } takes that too");
game.user = users.get("p1");
api.markTokens({ id: "mine", tokens: ["t1"], users: "all" });
check(takeSent().length === 0 && api.tokenMarks().length === 1, "a player's marks stay on the player's client, whoever they name");
api.clearTokenMarks();
game.user = users.get("gm");

/* ---- lines */
calls.length = 0;
id = api.link({ id: "ipu.who", from: "t1", to: "t2", label: "Attack" });
check(id === "ipu.who" && api.links().length === 1 && calls.some((c) => c[0] === "lineStyle" && c[1].color === C.danger) && calls.filter((c) => c[0] === "drawCircle").length >= 2 && texts.some((t) => t.text === "Attack"), "a line from one token to another: the line, a reticle on the target, its label");
calls.length = 0; T("t1").visible = false;
Hooks.callAll("refreshToken", T("t1"));
check(calls.some((c) => c[0] === "drawCircle") && !calls.some((c) => c[0] === "closePath"), "the attacker is not in this user's sight: the target keeps its reticle, no line is drawn from the attacker");
calls.length = 0; T("t1").visible = true; T("t2").visible = false;
Hooks.callAll("sightRefresh");
check(!calls.some((c) => c[0] === "drawCircle" || c[0] === "lineTo"), "the target is not in sight: nothing is drawn");
T("t2").visible = true;
api.clearLinks("ipu.who"); takeSent();
api.link({ id: "ipu.who", from: "h1", to: "t2", users: "all" });
out = takeSent();
const toP = out.find((m) => m.to?.includes("p1")), toG = out.find((m) => m.to?.includes("gm2"));
check(toP && toG && !toP.to.includes("gm2") && toP.msg.set[0].links[0].from === null && toG.msg.set[0].links[0].from.token === "h1", "a line from a token hidden from players: the GMs get it whole, the players only its target");
api.clearLinks(); takeSent();
check(api.link({ from: "t1" }) === null && api.links().length === 0, "a line without a target is none");

/* ---- a move under the pointer */
const click = (x, y, button = 0) => { view.fire("pointerdown", { button, clientX: x, clientY: y }); window.fire("pointerup", { button, clientX: x, clientY: y, target: view }); };
check((await api.pickMove({ token: "nobody" })).reason === "noToken", "no mover: refused");
let pr = api.pickMove({ token: "t1", profile: { way: "air", speed: 2 }, banner: false, zones: [{ zone: "z5", label: "1", cost: "quick action", more: true }, { zone: "z3", label: "1", cost: "full action · 1 stress", hazards: [{ zone: "z3", text: "Fire 4" }], color: "stress" }] });
check(api.picking() && !els.some((e) => !e.gone && e.className === "mm-z-pick"), "banner: false - the pick runs without the map's banner");
calls.length = 0; texts.length = 0;
view.fire("pointermove", { clientX: 500, clientY: 150 });
let tip = els.find((e) => !e.gone && e.className.includes("mm-z-pick-tip") && !e.className.includes("board"));
check(tip.innerHTML.includes("full action · 1 stress") && tip.innerHTML.includes("Fire 4") && !tip.innerHTML.includes("board.move.alt"), "hovering a zone on offer: the price and what waits on the way, beside the cursor");
check(calls.some((c) => c[0] === "lineStyle" && c[1].color === C.stress) && calls.some((c) => c[0] === "drawCircle") && texts.some((t) => t.text === "Fire 4"), "and on the map: the route in the entry's colour, a dot where a border is crossed, the hazard's chip");
view.fire("pointermove", { clientX: 900, clientY: 150 });
tip = els.find((e) => !e.gone && e.className.includes("mm-z-pick-tip") && !e.className.includes("board"));
check(tip.innerHTML.includes("quick action") && tip.innerHTML.includes("board.move.alt"), "a zone with another way says so");
click(900, 150);
let res = await pr;
check(res.ok && res.zone === "z5" && res.alt === false && J(res.route) === J(["z5"]) && res.entry.cost === "quick action", "one click confirms: the place, the zones entered, the caller's own entry");
pr = api.pickMove({ token: "t1", profile: { way: "air", speed: 2 }, zones: [{ zone: "z5", more: true }, { zone: "z3" }] });
click(900, 150, 2);
res = await pr;
check(res.ok && res.alt === true && res.zone === "z5", "a right click on a zone that has another way: the answer says so");
pr = api.pickMove({ token: "t1", profile: { way: "air", speed: 2 }, zones: [{ zone: "z5", more: true }, { zone: "z3" }] });
click(500, 150, 2);
check((await pr).reason === "cancelled", "a right click on a zone without one gives the pick up, as before");
await api.addZoneState("z5", { kind: "fire", level: 7 });
pr = api.pickMove({ token: "t1", profile: { way: "walk", speed: 1, stress: true } });
view.fire("pointermove", { clientX: 900, clientY: 150 });
tip = els.find((e) => !e.gone && e.className.includes("mm-z-pick-tip") && !e.className.includes("board"));
check(tip.innerHTML.includes("board.move.cost") && tip.innerHTML.includes("board.haz.fire"), "no zones given: what the profile reaches, priced in movement actions, with what the map itself knows waits there (a burning zone)");
view.fire("pointermove", { clientX: 500, clientY: 150 });
check(document.body.classList.contains("mm-z-pick-no"), "a zone the mover cannot reach is not on offer");
api.cancelPick(); await pr;
// a blocked border on a forced route
pr = api.pickMove({ token: "t1", profile: { way: "walk", speed: 2, force: true }, zones: [{ zone: "z3", cost: "full action" }] });
view.fire("pointermove", { clientX: 500, clientY: 150 });
tip = els.find((e) => !e.gone && e.className.includes("mm-z-pick-tip") && !e.className.includes("board"));
check(tip.innerHTML.includes("board.haz.wall"), "a wall on the way of a mover who may try it: named with its Armor");
api.cancelPick(); await pr;
// the GMs see where a player points
game.user = users.get("p1"); takeSent();
{ /* section 40: the price at a zone, its label and tip as signs */
  const SV = "data:image/svg+xml,%3Csvg viewBox='0 0 12 12'%3E%3C/svg%3E", q = { name: "Quick action", el: { tag: "i", cls: "ipu-cost ipu-k-quick" }, img: SV, w: 12 };
  sprites.length = 0; texts.length = 0;
  const p40 = api.pickMove({ token: "t1", profile: { way: "air", speed: 2 }, banner: false, zones: [{ zone: "z3", label: "Quick", tip: "Run: Quick", cost: "Run: quick action", signs: { label: [q], tip: ["Run: ", q], cost: ["Run: ", q] },
    hazards: [{ zone: "z3", text: "Wall, Armor 2", signs: { text: ["Wall, ", { name: "Armor: 2", n: 2, img: SV }] } }] }, { zone: "z5", label: "1", cost: "plain words" }] });
  view.fire("pointermove", { clientX: 500, clientY: 150 });
  const tp = els.find((e) => !e.gone && e.className.includes("mm-z-pick-tip") && !e.className.includes("board"));
  check(tp.innerHTML.includes('<span class="mm-z-cost">Run: <i class="ipu-cost ipu-k-quick" role="img" aria-label="Quick action" data-tooltip="Quick action"></i></span>') && !tp.innerHTML.includes("Run: quick action"), "40: the price at a zone as words and the caller's sign");
  check(tp.innerHTML.includes(' · <i class="ipu-cost ipu-k-quick"') && tp.innerHTML.includes('<small>Run: <i class="ipu-cost ipu-k-quick"') && tp.innerHTML.includes('Wall, <span class="mm-z-sign" role="img" aria-label="Armor: 2"'), "40: the zone's label and tip in the tooltip, and what waits on the way, as signs");
  check(sprites.length >= 2 && texts.some((t) => t.text === "Wall, ") && !texts.some((t) => t.text === "Quick" || t.text === "Wall, Armor 2"), "40: on the map the zone's label and the hazard's chip draw the pictures (sprites), not the words");
  view.fire("pointermove", { clientX: 900, clientY: 150 });
  const tp2 = els.find((e) => !e.gone && e.className.includes("mm-z-pick-tip") && !e.className.includes("board"));
  check(tp2.innerHTML.includes('<span class="mm-z-cost">plain words</span>'), "40: a zone without signs: its words as before");
  api.cancelPick(); await p40;
}
pr = api.pickMove({ token: "t1", profile: { way: "walk", speed: 1 }, zones: ["z5"], intent: { label: "Move" } });
view.fire("pointermove", { clientX: 900, clientY: 150 });
await tick(200);
out = takeSent().filter((m) => m.msg.op === "intent");
check(out.length >= 1 && out.every((m) => J(m.to) === J(["gm", "gm2"])) && out[out.length - 1].msg.intent.to.zone === "z5" && out[out.length - 1].msg.intent.label === "Move", "intent: where the player points goes to the GMs alone");
api.cancelPick(); await pr; await tick(200);
out = takeSent().filter((m) => m.msg.op === "intent");
check(out.length >= 1 && out[out.length - 1].msg.intent === null, "the pick ends: the intention is taken back");
game.user = users.get("gm");

/* ---- intentions on a GM's client */
const told = [];
Hooks.on("moinenMapsIntent", (u, i) => told.push([u, i]));
onSocket({ t: "board", op: "intent", scene: "scene1", intent: { token: "t1", to: "t2", zones: ["z5"], label: "Attack", ttl: 60 } }, "p1");
check(api.intents().length === 1 && api.intents()[0].user === "p1" && api.links().some((l) => l.id === "~intent.p1" && l.links[0].style === "dashed" && l.links[0].label === "Test Gracz 1: Attack") && api.highlights().some((h) => h.id === "~intent.p1" && h.zones[0].style === "dashed") && told.length === 1, "a player's intention on the GM's map: a dashed line with the player's name, dashed zones; the combat module is told");
await tick(120);
check(api.intents().length === 0 && !api.links().length && !api.highlights().length && told[told.length - 1][1] === null, "it goes by itself when it is not said again");
onSocket({ t: "board", op: "intent", scene: "scene1", intent: { token: "t2", to: "t1", label: "Lie" } }, "p1");
check(api.intents().length === 0 && !api.links().length, "an intention about a token the sender does not own is not shown");
onSocket({ t: "board", op: "intent", scene: "scene1", intent: { token: "t1", label: "Aiming" } }, "p1");
check(api.tokenMarks().some((m) => m.id === "~intent.p1" && m.tokens[0].tip === "Test Gracz 1: Aiming"), "nothing aimed at yet: the label stands on the player's token");
// U76: the pill carries the action's label alone (the user's name used to be glued before it and the sum cut to 18: "Test Gracz 1: Slug")
{
  const pill = () => api.tokenMarks().find((m) => m.id === "~intent.p1")?.tokens[0];
  check(pill().label === "Aiming" && pill().tip === "Test Gracz 1: Aiming", "U76: the pill over the token says the action's label, who armed it is in the tip");
  onSocket({ t: "board", op: "intent", scene: "scene1", intent: { token: "t1", label: "Slugfest: Omni-Man" } }, "p1");
  check(pill().label === "Slugfest: Omni-Man" && pill().label.length === BC.BOARD_LIMITS.label && pill().tip === "Test Gracz 1: Slugfest: Omni-Man", "U76: a label that fits the pill by itself (18 characters) is drawn whole");
  onSocket({ t: "board", op: "intent", scene: "scene1", intent: { token: "t1", label: "Uderzenie z rozbiegu w mur" } }, "p1");
  check(pill().label === "Uderzenie z rozbi…" && [...pill().label].length === BC.BOARD_LIMITS.label && pill().tip === "Test Gracz 1: Uderzenie z rozbiegu w mur", "U76: a longer label ends in an ellipsis inside the pill's length; the tip keeps it whole");
  onSocket({ t: "board", op: "intent", scene: "scene1", intent: { token: "t1" } }, "p1");
  check(pill().label === "Test Gracz 1" && pill().tip === "Test Gracz 1", "U76: no label: the pill says who");
  onSocket({ t: "board", op: "intent", scene: "scene1", intent: { token: "t1", to: "t2", label: "Slugfest: Omni-Man" } }, "p1");
  check(!pill() && api.links().find((l) => l.id === "~intent.p1")?.links[0].label === "Test Gracz 1: Slugfest: Omni-Man", "U76: aimed at something: the line carries \"user: label\", uncut, and no pill stands");
  check(BC.intentPill(null, null) === null && BC.intentPill("  ", "") === null && BC.intentPill(null, "A very long user name indeed") === "A very long user…", "U76: intentPill: nothing to say is null; a long name is cut the same way");
  onSocket({ t: "board", op: "intent", scene: "scene1", intent: { token: "t1", label: "Aiming" } }, "p1");
}
check(api.intents(false).length === 1 && !api.tokenMarks().length && api.intents(true).length === 1 && api.tokenMarks().length === 1, "a GM can hide the intentions on their own screen and show them again");
onSocket({ t: "board", op: "intent", scene: "scene1", intent: null }, "p1");
check(!api.tokenMarks().length && api.intents().length === 0, "taken back by the player");
game.user = users.get("p2");
onSocket({ t: "board", op: "intent", scene: "scene1", intent: { token: "t1", to: "t2" } }, "p1");
check(api.intents().length === 0 && !api.links().length, "a player's client shows nobody's intention");
game.user = users.get("gm");

/* ---- areas and warnings */
let ar = api.areaPreview({ at: "z4", radius: 1, tokens: (d) => (d.id === "t3" ? { label: "ally" } : true) });
check(J([...ar.zones].sort()) === J(["z3", "z4", "z5"]) && J([...ar.tokens].sort()) === J(["h1", "t1", "t2", "t3"]) && boardOf("t3")?.e.state === "caught" && boardOf("t3").e.label === "ally" && boardOf("t2").e.color === C.range && api.highlights().some((h) => h.id === "area" && h.zones.length === 3), "an area: its zones highlighted, everyone standing in them ringed (allies too), each with what the caller says");
check(api.clearArea() === 2 && !boardOf("t2") && !api.highlights().length, "taken away in one call");
takeSent();
api.areaPreview({ id: "blast", zones: ["z5"], users: ["p1"] });
out = takeSent();
check(out.some((m) => m.msg.t === "zones" && m.msg.op === "hl" && J(m.to) === J(["p1"])) && J(out.find((m) => m.msg.op === "tm" && m.to.includes("p1")).msg.set[0].tokens.map((e) => e.token)) === J(["t2"]), "shown to a player: the zones and the tokens in them, without the one hidden from players");
api.clearArea("blast"); takeSent();
game.user = users.get("p1"); T("t2").visible = false;
ar = api.areaPreview({ zones: ["z5"] });
check(J(ar.tokens) === "[]", "on a player's own client an area never names a token that player does not see");
api.clearArea(); T("t2").visible = true; game.user = users.get("gm");
pr = api.pickArea({ zones: ["z3", "z4", "z5"], radius: 1, title: "Blast" });
view.fire("pointermove", { clientX: 900, clientY: 150 });
check(J(api.highlights().find((h) => h.id === "~area").zones.map((e) => e.zone).sort()) === J(["z4", "z5"]) && boardOf("t1")?.e.state === "caught" && boardOf("t2")?.e.state === "caught" && !boardOf("t3"), "picking where an area goes: under the pointer the zones it would cover and who stands in them");
view.fire("pointermove", { clientX: 500, clientY: 150 });
check(J(api.highlights().find((h) => h.id === "~area").zones.map((e) => e.zone).sort()) === J(["z2", "z3", "z4"]) && boardOf("t3") && !boardOf("t2"), "it follows the pointer");
click(500, 150);
res = await pr;
check(res.ok && res.zone === "z3" && J([...res.area].sort()) === J(["z2", "z3", "z4"]) && J([...res.caught].sort()) === J(["t1", "t3"]) && !api.highlights().length && !boardOf("t3"), "the answer carries the zones covered and the tokens caught; the preview is gone");
pr = api.pickArea({ zones: ["z5"], area: (key) => [key, "z1"] });
view.fire("pointermove", { clientX: 900, clientY: 150 });
check(J(api.highlights().find((h) => h.id === "~area").zones.map((e) => e.zone).sort()) === J(["z1", "z5"]), "the caller's own shape of an area");
api.cancelPick(); await pr;
id = api.warn({ zones: [{ zone: "z5", text: "Fire will spread" }, "z4"], borders: [{ border: "z4|z5", text: "Held" }] });
let wz = api.highlights().find((h) => h.id === "warn");
check(id === "warn" && wz.zones[0].label === "Fire will spread" && wz.zones[0].icon === "warn" && wz.zones[0].style === "dashed" && wz.zones[0].color === C.danger && wz.zones[1].icon === "warn" && wz.borders[0].label === "Held" && wz.order === 50, "a warning on a zone or a border: a dashed danger band and a chip with a sign and the caller's words");
api.clearHighlights("warn");

/* ---- a menu at a thing */
const rowOf = (i, step = null) => { const outEl = { textContent: "" }, row = { dataset: { i: String(i) }, querySelector: () => outEl, classList: classList(), attrs: {}, setAttribute(k, v) { row.attrs[k] = v; }, outEl }; return { row, target: { target: { closest: (sel) => (sel === "[data-i]" ? row : sel === "[data-step]" && step ? { dataset: { step: String(step) } } : null) } } }; };      // (`target`: the click event to fire)
const menuEl = () => els.find((e) => !e.gone && e.className === "mm-z-menu");
check((await api.menu({ token: "t2", items: [] })).reason === "noItems" && (await api.menu({ token: "nobody", items: [{ label: "x" }] })).reason === "noAnchor", "no entry or nothing to stand at: no menu");
let ran = 0;
pr = api.menu({ token: "t2", title: "Omni-Man", items: [{ id: "atk", label: "Attack", icon: "fa-solid fa-hand-fist", hint: "62 %", run: () => ran++ }, { id: "grab", label: "Grab", disabled: "Out of reach" }] });
check(api.menuOpen() && menuEl().innerHTML.includes("Omni-Man") && menuEl().innerHTML.includes("62 %") && menuEl().innerHTML.includes("Out of reach") && menuEl().style.left === "960px", "a menu at a token: its entries with icon, hint and the reason on the one that cannot be used; it stands beside the token");
menuEl().fire("click", rowOf(1).target);
check(api.menuOpen(), "a disabled entry cannot be picked");
menuEl().fire("click", rowOf(0).target);
res = await pr;
check(res.ok && res.id === "atk" && res.index === 0 && ran === 1 && !api.menuOpen() && !menuEl(), "picking an entry closes the menu, runs it and answers with its id");
/* section 40: signs where the menu draws its text */
const SIGN_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M0,0H12V12Z'/%3E%3C/svg%3E";
const sQuick = { name: "Quick action", el: { tag: "i", cls: "ipu-cost ipu-k-quick" }, img: SIGN_SVG, w: 12 };
pr = api.menu({ token: "t2", title: "Door", sub: "Locked, Armor 2", signs: { sub: ["Locked, ", { name: "Armor: 2", el: { tag: "span", cls: "ipu-sym", kids: [{ tag: "i", cls: "ipu-cost ipu-k-armor" }, { tag: "b", text: "2" }] } }] },
  items: [{ id: "atk", label: "Attack", hint: "Quick · good", signs: { hint: [sQuick, " good"] } }, { id: "old", label: "Look", hint: "Free" }] });
check(menuEl().innerHTML.includes('<span class="hint has-signs"><i class="ipu-cost ipu-k-quick" role="img" aria-label="Quick action" data-tooltip="Quick action"></i> good</span>') && menuEl().innerHTML.includes('<span class="hint">Free</span>'), "40: a row's hint as signs and words (the caller's classes, named); a row without signs keeps its words");
check(menuEl().innerHTML.includes('<small>Locked, <span class="ipu-sym" role="img" aria-label="Armor: 2" data-tooltip="Armor: 2"><i class="ipu-cost ipu-k-armor"></i><b>2</b></span></small>') && !menuEl().innerHTML.includes("Locked, Armor 2"), "40: the sub line as words and a sign");

const steps = [], togs = [];
pr = api.menu({ token: "t2", items: [{ id: "hp", label: "Health", stepper: { value: 3, min: 0, max: 4 }, onStep: (v, d) => { steps.push([v, d]); } }, { id: "held", label: "Held", toggle: true, on: false, onToggle: (on) => { togs.push(on); } }, { id: "end", label: "End turn" }] });
let r1 = rowOf(0, 1);
menuEl().fire("click", r1.target); await tick();
menuEl().fire("click", r1.target); await tick();
menuEl().fire("click", rowOf(0, -1).target); await tick();
check(J(steps) === J([[4, 1], [3, -1]]) && r1.row.outEl.textContent === "4" && api.menuOpen(), "a stepper tells each step inside its limits and keeps the menu open (quick corrections of health or stress)");
let r2 = rowOf(1);
menuEl().fire("click", r2.target); await tick();
check(J(togs) === J([true]) && r2.row.attrs["aria-checked"] === "true" && api.menuOpen(), "a toggle tells its new state and keeps the menu open (a state on or off)");
window.fire("keydown", { key: "1" });
res = await pr;
check(res.ok && res.id === "end", "a digit picks the plain entries in order");
pr = api.menu({ zone: "z3", items: [{ label: "Look" }] });
const pr3 = api.menu({ border: "z2|z3", items: [{ label: "Open" }] });
check((await pr).reason === "replaced" && menuEl().style.left === "424px", "a new menu replaces the open one; at a border it stands at the border's mark");
window.fire("keydown", { key: "Escape" });
check((await pr3).reason === "cancelled", "Escape closes it");
pr = api.menu({ x: 100, y: 100, items: [{ label: "Here" }] });
Hooks.callAll("canvasTearDown");
check((await pr).reason === "sceneChanged", "the scene closes under a menu: it ends");
open(sc); tokObjs(); takeSent();

/* ---- a right click on a thing of the map */
const seen = [];
const downs = (x, y, o = {}) => { let stopped = false; window.fire("pointerdown", { button: 2, clientX: x, clientY: y, target: view, stopImmediatePropagation() { stopped = true; }, ...o }); return stopped; };
const wd0 = (window.ls.get("pointerdown") ?? []).length;
const off = api.onContext((ctx) => { seen.push(ctx); return ctx.kind === "token" && ctx.token.id === "t2" ? { title: "T2", items: [{ id: "a", label: "Attack" }], done: (r) => seen.push(r) } : ctx.kind === "border" ? true : null; });
check(downs(700, 100) === false && seen.length === 1 && seen[0].kind === "token" && seen[0].token.id === "t1" && seen[0].zone === "z4" && !api.menuOpen(), "a right click on a token the caller does not claim: Foundry gets it as always");
check(downs(860, 60) === true && !api.menuOpen(), "one the caller claims is taken from Foundry while the button goes down");
window.fire("pointerup", { button: 2, clientX: 860, clientY: 60, target: view });
await tick();
check(api.menuOpen() && menuEl().innerHTML.includes("T2"), "and the caller's menu opens at the token when the button comes up");
menuEl().fire("click", rowOf(0).target); await tick();
check(seen[seen.length - 1].ok === true && seen[seen.length - 1].id === "a", "the caller is told the answer");
pans.length = 0;
downs(860, 60);
window.fire("pointermove", { clientX: 900, clientY: 60 });
window.fire("pointerup", { button: 2, clientX: 900, clientY: 60, target: view });
await tick();
check(pans.length === 1 && pans[0].x === -40 && !api.menuOpen(), "a right press that turns into a drag still moves the map and opens nothing");
seen.length = 0;
check(downs(401, 100) === true && seen[0].kind === "border" && seen[0].border.key === "z2|z3" && seen[0].border.doorway.state === "locked", "a right click on a door: the caller gets the border with its wall and door");
window.fire("pointerup", { button: 2, clientX: 401, clientY: 100, target: view });
seen.length = 0;
downs(300, 30);
check(seen[0].kind === "zone" && seen[0].zone === "z2" && seen[0].place.zone === "z2", "on open ground: the zone");
seen.length = 0;
pr = api.pick({ zones: ["z1"] });
check(downs(860, 60) === false && seen.length === 0, "while a zone is being picked the right click is the pick's");
api.cancelPick(); await pr;
off();
check(downs(860, 60) === false && (window.ls.get("pointerdown") ?? []).length === wd0, "taken back: nothing listens");

/* ---- one language of zones */
check(api.present() === null, "nothing asked: the zones show as the scene says");
const refreshes = []; Hooks.on("moinenMapsZones", (k) => refreshes.push(k));
let pv = api.present({ numbers: "always", distances: false });
check(pv.numbers === "always" && pv.distances === false && pv.show === false && refreshes.includes("params"), "present: numbers on every zone, no distance badges; the display is told");
sc.flags[MOD].zones.look.who = "gm"; Hooks.callAll("updateScene", sc, { flags: { [MOD]: { zones: sc.flags[MOD].zones } } });
game.user = users.get("p1");
const shows = () => api.present() && Zones.visibleToMe();
check(Zones.visibleToMe() === false, "a scene that keeps its zones to the GM hides them from a player");
api.present({ numbers: "always", show: true });
check(Zones.visibleToMe() === true && shows(), "show: true - the zones show on this client while the combat module asks for it");
api.present(null);
check(Zones.visibleToMe() === false && api.present() === null, "present(null): as the scene says again");
game.user = users.get("gm");

/* ---- nothing left behind */
Hooks.callAll("canvasTearDown");
check(api.tokenMarks().length === 0 && api.links().length === 0 && api.intents().length === 0 && !api.menuOpen(), "the scene closes: marks, lines, intentions and menus are gone");

console.log(failed ? `${failed} failed` : "all zones board checks passed");
process.exit(failed ? 1 : 0);
