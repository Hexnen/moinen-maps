// The stand-in Foundry of dev/zones-adv7.test.mjs (not a test itself): tokens that really update (preUpdateToken may veto, updateToken
// is told), the module socket with several users, pointer and key events on the window and the canvas, animation frames that run at
// once or wait in a queue, a recording PIXI. Merged from dev/zones-play.test.mjs and dev/zones-board.test.mjs; it loads the tree's
// real scripts/zones modules. One process plays every client: `as(userId)` says whose client it is now.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
export const MOD = "moinen-maps";
export const J = JSON.stringify;
export const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
export const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if ( !ok ) failed++; };
export const failures = () => failed;

/* ---- recording PIXI */
export const calls = [];
const anyFn = () => new Proxy(class Any {}, { get: (t, k) => (typeof k === "symbol" ? undefined : k === "prototype" ? t.prototype : anyFn()), apply: () => anyFn(), construct: () => anyFn() });
export class Node {
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
export const texts = [];
const pixi = {
  Container: Node, Graphics: recorder("g"), Sprite: recorder("s"),
  Text: class extends Node { constructor(text, style) { super(); this.text = text; this.style = style; this.width = String(text).length * 7; texts.push(this); } },
  Texture: { EMPTY: {}, from: () => ({ destroy() {} }) },
  LINE_CAP: { ROUND: "round" }, LINE_JOIN: { ROUND: "round", MITER: "miter" }, BLEND_MODES: { ADD: 1, MULTIPLY: 2, NORMAL: 0 }
};
globalThis.PIXI = new Proxy(pixi, { get: (t, k) => (k in t ? t[k] : typeof k === "symbol" ? undefined : anyFn()) });
const warn0 = console.warn;
export const warns = [];
console.warn = (...a) => { warns.push(a.map(String).join(" ")); if ( process.env.ZONES_WARN && !/chunk worker|style wash/.test(String(a[0])) ) warn0(...a); };

/* ---- stand-in Foundry */
const hooks = new Map();
globalThis.Hooks = {
  on(name, fn) { if ( !hooks.has(name) ) hooks.set(name, []); hooks.get(name).push(fn); return fn; },
  once(name, fn) { return this.on(name, fn); },
  off(name, fn) { const l = hooks.get(name); if ( l?.includes(fn) ) l.splice(l.indexOf(fn), 1); },
  callAll(name, ...args) { for ( const fn of [...(hooks.get(name) ?? [])] ) fn(...args); return true; },
  call(name, ...args) { for ( const fn of [...(hooks.get(name) ?? [])] ) if ( fn(...args) === false ) return false; return true; }
};
export const hookCount = (name) => (hooks.get(name) ?? []).length;
const listeners = (o) => { o.ls = new Map(); o.addEventListener = (t, fn) => { (o.ls.get(t) ?? o.ls.set(t, []).get(t)).push(fn); }; o.removeEventListener = (t, fn) => { const l = o.ls.get(t); if ( l?.includes(fn) ) l.splice(l.indexOf(fn), 1); }; o.fire = (t, ev = {}) => { for ( const fn of [...(o.ls.get(t) ?? [])] ) fn({ preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...ev }); }; return o; };
const classList = () => { const s = new Set(); return { add: (...c) => c.forEach((x) => s.add(x)), remove: (...c) => c.forEach((x) => s.delete(x)), toggle: (c, on) => (on ? s.add(c) : s.delete(c)), contains: (c) => s.has(c), s }; };
export const els = [];
const makeEl = () => { const e = listeners({ className: "", classList: classList(), style: {}, innerHTML: "", gone: false, dataset: {}, setAttribute() {}, remove() { e.gone = true; }, append() {}, querySelector: () => e.btn ??= makeEl(), contains: () => false }); els.push(e); return e; };
const settings = new Map();
globalThis.foundry = anyFn();
globalThis.CONFIG = {};
globalThis.window = listeners(globalThis);
export const win = globalThis;
globalThis.document = listeners({ visibilityState: "visible", body: { append() {}, classList: classList() }, createElement: makeEl });
/* requestAnimationFrame: "now" runs the callback at once (as the tree's own board test does); "queue" keeps it until flushRaf() */
export const raf = { mode: "now", q: [] };
globalThis.requestAnimationFrame = (fn) => { if ( raf.mode === "now" ) { fn(); return 0; } raf.q.push(fn); return raf.q.length; };
globalThis.cancelAnimationFrame = () => {};
export const flushRaf = () => { const q = raf.q.splice(0); for ( const fn of q ) fn(); return q.length; };
export const notes = [];
globalThis.ui = { notifications: { info: (m) => notes.push(["info", m]), warn: (m) => notes.push(["warn", m]) } };
globalThis.ChatMessage = { create: async () => {} };
export const sent = [];
const socketFns = [];
export const onSocket = (msg, sender) => { for ( const fn of socketFns ) fn(msg, sender); };
export const users = new Map([["gm", { id: "gm", isGM: true, active: true, name: "Ada" }], ["gm2", { id: "gm2", isGM: true, active: true, name: "Bo" }], ["p1", { id: "p1", isGM: false, active: true, name: "Test Gracz 1" }], ["p2", { id: "p2", isGM: false, active: true, name: "Test Gracz 2" }]]);
export const keyboard = { alt: false, isModifierActive: (k) => k === "Alt" && keyboard.alt };
globalThis.game = {
  user: users.get("gm"),
  users: { activeGM: users.get("gm"), get: (id) => users.get(id), filter: (fn) => [...users.values()].filter(fn) },
  i18n: { lang: "en", localize: (k) => k, format: (k, d) => `${k}${d ? J(d) : ""}`, has: () => false },
  settings: { register: (m, k, o) => settings.set(k, o.default), get: (m, k) => { if ( !settings.has(k) ) throw new Error(`no setting ${k}`); return settings.get(k); } },
  scenes: { get: () => scene },
  modules: { get: () => ({ title: "Plus Ultra" }) },
  socket: { emit: (ch, msg, o) => sent.push({ msg, to: o?.recipients ?? null }), on: (ch, fn) => { socketFns.push(fn); } },
  keyboard
};
export const as = (id) => { game.user = users.get(id); };
export const takeSent = () => sent.splice(0);

const expand = (flat) => { const o = {}; for ( const [k, v] of Object.entries(flat) ) { const ps = k.split("."); let t = o; ps.slice(0, -1).forEach((p) => { t = t[p] ??= {}; }); t[ps.at(-1)] = v; } return o; };
const applyFlags = (flags, ch) => { for ( const [k, v] of Object.entries(ch ?? {}) ) { if ( k.startsWith("-=") ) delete flags[k.slice(2)]; else flags[k] = v; } };
let scene = null;
export const writes = [];
export function makeScene(flag, tokens = [], id = "scene1") {
  const s = { id, flags: { [MOD]: flag ? { zones: JSON.parse(J(flag)) } : {} }, saves: 0 };
  s.update = async (data) => { s.saves++; for ( const [k, v] of Object.entries(data) ) if ( k === `flags.${MOD}.zones` ) s.flags[MOD].zones = JSON.parse(J(v)); return s; };
  s.tokens = tokens.map(([tid, x, y, fl, size]) => makeToken(s, tid, x, y, fl, size));
  s.tokens.get = (tid) => s.tokens.find((t) => t.id === tid) ?? null;
  s.updateEmbeddedDocuments = async (type, updates, options = {}) => {
    writes.push({ ids: updates.map((u) => u._id), options });
    for ( const u of updates ) { const { _id, ...flat } = u; const t = s.tokens.get(_id); if ( !t ) throw new Error(`no token ${_id}`); await t.update(flat, options); }
    return updates;
  };
  return s;
}
export function makeToken(s, id, x, y, fl = {}, size = 1) {
  const d = { id, name: id, uuid: `Scene.${s.id}.Token.${id}`, x, y, width: size, height: size, actorId: `actor-${id}`, isOwner: true, parent: s, documentName: "Token", flags: { [MOD]: { ...fl } }, object: null, sort: 0, hidden: false };
  d.getFlag = (m, k) => d.flags[m]?.[k];
  d.testUserPermission = () => true;
  /* update as Foundry does it: preUpdateToken may veto, then the change is applied and updateToken is told. `by`: the user who writes */
  d.update = async (flat, options = {}) => {
    const ch = expand(flat);
    if ( Hooks.call("preUpdateToken", d, ch, options, game.user.id) === false ) return undefined;
    for ( const k of ["x", "y"] ) if ( k in ch ) d[k] = ch[k];
    applyFlags(d.flags[MOD], ch.flags?.[MOD]);
    if ( d.object ) { d.object.x = d.x; d.object.y = d.y; }
    Hooks.callAll("updateToken", d, ch, options, game.user.id);
    return d;
  };
  d.unsetFlag = (m, k) => d.update({ [`flags.${m}.-=${k}`]: null });
  d.setFlag = (m, k, v) => d.update({ [`flags.${m}.${k}`]: v });
  return d;
}
export function deleteToken(s, id) {
  const d = s.tokens.get(id), i = s.tokens.indexOf(d);
  if ( i < 0 ) return;
  s.tokens.splice(i, 1);
  if ( globalThis.canvas?.tokens ) canvas.tokens.placeables = canvas.tokens.placeables.filter((t) => t.document !== d);
  if ( d.object ) d.object.destroyed = true;
  Hooks.callAll("deleteToken", d, {}, game.user.id);
}
export let view = null;
export const pans = [];
export function open(s, dims = { size: 100, width: 1000, height: 400, sceneRect: { x: 0, y: 0, width: 1000, height: 200 } }) {
  if ( globalThis.canvas?.scene ) Hooks.callAll("canvasTearDown");
  scene = s;
  view = listeners({ getBoundingClientRect: () => ({ left: 0, top: 0 }) });
  globalThis.canvas = {
    scene: s, ready: true, dimensions: dims, grid: { size: dims.size },
    app: { view, ticker: { fns: new Set(), add(f) { this.fns.add(f); }, remove(f) { this.fns.delete(f); } }, renderer: anyFn() },
    primary: new Node(), interface: new Node(), tokens: { controlled: [], placeables: [] }, stage: { scale: { x: 1 }, pivot: { x: 0, y: 0 } },
    canvasCoordinatesFromClient: (p) => ({ x: p.x, y: p.y }), clientCoordinatesFromCanvas: (p) => ({ x: p.x, y: p.y }), pan: (to) => { pans.push(to); }
  };
  canvas.tokens.placeables = s.tokens.map((d) => {
    const t = new Node();
    Object.assign(t, { id: d.id, document: d, x: d.x, y: d.y, w: 100 * d.width, h: 100 * d.height, visible: true, controlled: false, mesh: { tint: 0xffffff, destroyed: false } });
    d.object = t;
    return t;
  });
  Hooks.callAll("canvasReady");
}
export const click = (x, y, button = 0) => { window.fire("pointerdown", { button, clientX: x, clientY: y, target: view }); window.fire("pointerup", { button, clientX: x, clientY: y, target: view }); };
export const moveTo = (x, y) => view.fire("pointermove", { clientX: x, clientY: y });

export const Zones = await imp("scripts/zones/zones.mjs");
export const { api: moduleApi } = await imp("scripts/attrs.mjs");
export const fire = { painted: 0, putOut: 0 };
moduleApi.fire = { paint: () => { fire.painted++; return "f1"; }, remove: () => { fire.putOut++; } };
Zones.registerZones();
Hooks.callAll("init");
Hooks.callAll("ready");
export const api = Zones.zonesApi;
export const events = [];
Hooks.on(api.EVENT_HOOK, (type, payload) => events.push({ type, ...payload }));
export const takeEvents = () => events.splice(0);

/* five zones in a row (dividers at 200, 400, 600, 800 in a 1000 x 200 scene): a wall z1|z2, a locked door z2|z3, an exterior wall
   z3|z4, z4|z5 open; z3 is a building with two floors (the tree's own fixture) */
export const ROW = {
  v: 1, s: [[1, [200, -20, 200, 220]], [2, [400, -20, 400, 220]], [3, [600, -20, 600, 220]], [4, [800, -20, 800, 220]]], next: 5, preset: null, snap: 0.25, smooth: 0,
  look: { who: "all", lineStyle: "solid" }, w: [[200, 100, "wall"], [400, 100, "locked"], [600, 100, "outer"]], m: [[500, 100, { building: true, floors: 2 }]]
};
/* four zones, two by two, in a 1000 x 200 scene (a divider at x = 500 and one at y = 100): `walls` are [x, y, kind] marks */
export const GRID = (walls = []) => ({
  v: 1, s: [[1, [500, -20, 500, 220]], [2, [-20, 100, 1020, 100]]], next: 3, preset: null, snap: 0.25, smooth: 0,
  look: { who: "all", lineStyle: "solid" }, w: walls, m: []
});
