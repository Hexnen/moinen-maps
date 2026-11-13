/* LETR tools (contract v5): the engine's own settings, authoring API, networking helper, accessibility and windows, ONCE for every
   caller, whichever module(s) carry the engine. Both copies of scripts/letters/ import this file (index.mjs); at `init` the copy with
   the highest VERSION wins (one registration), exactly like the engine itself.

   Where things live (stable whichever module is active):
   - settings: namespace "moinen-letters" (client settings: this computer; `styles`: world, written by the GM). They are not listed
     in Foundry's settings window themselves (a namespace that is not a package lands in "Unmapped"); a menu button "Lettering
     settings" in the HOST module's tab opens the engine's own settings window. Host = moinen-maps when active, else
     invincible-plus-ultra (same on every client: module activation is per world).
   - socket: the host module's channel ("module.<host>"), messages { t: "letr", ... } (the modules' own listeners ignore them).
   - keybinding "Letter this now" (GM, Shift+L, editable) and the designer button in the token controls: under the host module.
   Engine API added here (README "Tools"): L.prefs, L.settings(), L.registerMood/Palette/Font/Style, L.styles, L.saveStyle,
   L.deleteStyle, L.net.{play,burst,stream,stop,sharedNow,local}, L.letterNow, L.designer(), L.openSettings(), L.planFor. */
import { SETTINGS, DEFAULTS, cleanAll, resolveOpts, filterPlan } from "./prefs.mjs";
import { STRINGS } from "./strings.mjs";
import * as A from "./author.mjs";
import * as N from "./net.mjs";
import { COLORS, TICK, MOODS, MOOD_IDS } from "./design.mjs";

export const NS = "moinen-letters";
const LOG = "LETR |";
export const state = {
  prefs: { ...DEFAULTS }, styles: A.makeStyles(), fromWorld: new Set(), flashLog: [], host: null, engine: null, base: null,
  live: null, liveQ: [], liveT: 0, gate: N.rateGate(30), net: new Map(), warned: new Set()
};
const osReduced = () => { try { return !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const t = (k, d) => globalThis.game?.i18n?.format?.(`LETR.${k}`, d ?? {}) ?? k;
export const hostId = () => (game.modules.get("moinen-maps")?.active ? "moinen-maps" : "invincible-plus-ultra");
const channel = () => `module.${state.host}`;

/* ---------- filters installed on the engine ---------- */
export function install(L, base) {
  if ( !L || L._toolsInstalled ) return L;
  L._toolsInstalled = true;
  state.engine = L; state.base = base ?? L.base;
  const ext = L._ext;
  if ( !ext ) { console.warn(`${LOG} engine ${L.version} has no tool hooks; settings not applied`); return L; }
  ext.opts.push((opts) => resolveOpts(opts, state.prefs, state.styles.table, { osReduced: osReduced() }));
  ext.plan.push((plan, h) => {
    const o = h?.opts ?? {};
    const vh = globalThis.innerHeight ?? 800, zoom = h?.space === "world" ? (globalThis.canvas?.stage?.scale?.x || 1) : 1;
    const capPx = h?.size ? h.size * plan.sizeK * zoom : 0;
    const now = performance.now();
    filterPlan(plan, o, { prefs: state.prefs, colors: COLORS, TICK, flashLog: state.flashLog, now, t0: Number.isFinite(o.startAt) ? o.startAt : now + 0,
      capPx, vh, preview: !!h?.still });
  });
  ext.start.push(announce);
  /* a stream with a style: the style's mood, palette, colours and motion under the stream's own options (one hand for all syllables) */
  const stream0 = L.stream;
  L.stream = (o = {}) => {
    const st = typeof o?.style === "string" ? state.styles.get(o.style) : null;
    if ( !st ) return stream0(o);
    const { label, hand, font, sound, ...rest } = st;
    return stream0({ ...rest, ...o, style: undefined });
  };
  applyLimits();
  Object.defineProperty(L, "moods", { configurable: true, enumerable: true, get: () => MOOD_IDS.map((id) => ({ id, label: MOODS[id].label, sound: { ...MOODS[id].sound }, custom: !!MOODS[id].custom })) });
  Object.defineProperty(L, "prefs", { configurable: true, enumerable: true, get: () => ({ ...state.prefs }) });
  Object.assign(L, {
    settings: () => ({ ...state.prefs }),
    registerMood: A.registerMood, registerPalette: A.registerPalette,
    registerFont: (id, def) => A.registerFont(id, def, L._bank),
    registerStyle: (name, style) => state.styles.register(name, style),
    unregisterStyle: (name) => state.styles.remove(name),
    styles: () => state.styles.list(), style: (name) => state.styles.get(name),
    saveStyle, deleteStyle,
    palettes: () => Object.keys(COLORS), motionNames: A.motionNames,
    net: netApi(L),
    letterNow, designer: openDesigner, openSettings, planFor: (text, opts) => planFor(L, text, opts)
  });
  return L;
}
function applyLimits() { const L = state.engine; if ( !L ) return; L.limits.screen = state.prefs.limitScreen; L.limits.world = state.prefs.limitWorld; }

/* the plan this client would show for a call (designer preview): style, preferences and filters, without touching the flash budget */
export function planFor(L, text, opts = {}) {
  const o = resolveOpts({ ...opts, force: true }, state.prefs, state.styles.table, { osReduced: osReduced() });
  const plan = L._plan(String(text ?? ""), o);
  L._settle(plan);
  filterPlan(plan, o, { prefs: state.prefs, colors: COLORS, TICK, flashLog: [], preview: true, capPx: 0, vh: 1 });
  return { plan, opts: o };
}

/* ---------- settings ---------- */
function readPrefs() {
  const v = {};
  for ( const k of Object.keys(SETTINGS) ) { try { v[k] = game.settings.get(NS, k); } catch { v[k] = DEFAULTS[k]; } }
  state.prefs = cleanAll(v);
  applyLimits();
}
export async function setPrefs(values) {
  for ( const [k, v] of Object.entries(cleanAll({ ...state.prefs, ...values })) ) if ( game.settings.get(NS, k) !== v ) await game.settings.set(NS, k, v);
  readPrefs();
}
function registerSettings() {
  const type = { bool: Boolean, num: Number, pick: String };
  for ( const [k, d] of Object.entries(SETTINGS) ) {
    game.settings.register(NS, k, { name: `LETR.Settings.${k}.Name`, hint: `LETR.Settings.${k}.Hint`, scope: "client", config: false,
      type: type[d.type], default: d.default, onChange: () => readPrefs() });
  }
  game.settings.register(NS, "styles", { scope: "world", config: false, type: Object, default: {}, onChange: () => syncStyles() });
  const { ApplicationV2 } = foundry.applications.api;
  class LettersMenu extends ApplicationV2 { render() { openSettings(); return this; } }
  game.settings.registerMenu(state.host, "letters", { name: "LETR.Settings.Menu.Name", label: "LETR.Settings.Menu.Label",
    hint: "LETR.Settings.Menu.Hint", icon: "fa-solid fa-burst", type: LettersMenu, restricted: false });
}
function syncStyles() {
  let obj = {};
  try { obj = game.settings.get(NS, "styles") ?? {}; } catch {}
  state.styles.syncWorld(obj, state.fromWorld);
  Hooks.callAll("moinenLettersStyles", state.styles.list());
}
/* GM: a named style kept in the world (every client, every module) */
async function saveStyle(name, style) {
  if ( !game.user.isGM ) throw new Error(`${LOG} only a GM saves styles to the world`);
  state.styles.register(name, style);   // validates
  const all = { ...(game.settings.get(NS, "styles") ?? {}) };
  all[name] = state.styles.get(name);
  await game.settings.set(NS, "styles", all);
  return name;
}
async function deleteStyle(name) {
  if ( !game.user.isGM ) throw new Error(`${LOG} only a GM deletes world styles`);
  const all = { ...(game.settings.get(NS, "styles") ?? {}) };
  delete all[name];
  await game.settings.set(NS, "styles", all);
  state.styles.remove(name);
}

/* ---------- words ---------- */
function mergeStrings() {
  const lang = game.i18n.lang === "pl" ? "pl" : "en";
  const exp = (o) => foundry.utils.expandObject(o);
  foundry.utils.mergeObject(game.i18n.translations, exp(STRINGS[lang]), { overwrite: false });
  if ( game.i18n._fallback ) foundry.utils.mergeObject(game.i18n._fallback, exp(STRINGS.en), { overwrite: false });
}

/* ---------- accessibility: the word as text, for screen readers ---------- */
function announce(h) {
  if ( !state.prefs.announce || h.opts?._stream === true ) return;
  const text = String(h.opts?.alt ?? (typeof h.opts?._stream === "string" ? h.opts._stream : h.plan?.word ?? h.text)).trim();
  if ( !text ) return;
  if ( !state.live?.isConnected ) {
    const el = document.createElement("div");
    el.id = "moinen-letters-say"; el.className = "moinen-letters-say";
    el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite"); el.setAttribute("aria-atomic", "true");
    Object.assign(el.style, { position: "fixed", width: "1px", height: "1px", margin: "-1px", padding: "0", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: "0" });
    document.body.appendChild(el);
    state.live = el;
  }
  /* words of one moment are read together; the same word twice in a row once */
  if ( state.liveQ.at(-1) !== text ) state.liveQ.push(text);
  clearTimeout(state.liveT);
  state.liveT = setTimeout(() => { state.live.lang = game.i18n?.lang ?? "en"; state.live.textContent = state.liveQ.slice(0, 8).join(" · "); state.liveQ = []; }, 250);
}

/* ---------- networking ---------- */
const sharedNow = () => { const s = game.time?.serverTime; return Number.isFinite(s) ? s : Date.now(); };
function warnOnce(key) { if ( state.warned.has(key) ) return; state.warned.add(key); console.warn(`${LOG} net: "${key}" cannot travel to other clients (a function, a Promise or an element); it is left out there`); }
const sceneId = () => globalThis.canvas?.scene?.id ?? null;
function findToken(id) { return globalThis.canvas?.tokens?.get?.(id)?.document ?? null; }
function emit(msg) { try { game.socket.emit(channel(), msg); } catch ( e ) { console.warn(`${LOG} net`, e); } }

function netApi(L) {
  const lead = (o) => (Number.isFinite(o?.lead) ? Math.max(0, Math.min(2000, o.lead)) : 120);
  const play = (text, opts = {}) => {
    const id = N.netId(), seed = opts.seed ?? `net:${id}`, at = sharedNow() + lead(opts) + (opts.delay > 0 ? opts.delay : 0);
    const wire = N.wireOpts({ ...opts, seed, delay: undefined }, N.OP_KEYS, warnOnce);
    emit({ t: "letr", v: 1, op: "play", id, at, scene: sceneId(), text: String(text ?? "").slice(0, N.MAX_TEXT), opts: wire });
    const h = L.play(text, { ...opts, seed, delay: lead(opts) + (opts.delay > 0 ? opts.delay : 0) });
    h.netId = id; keep(id, [h]);
    return h;
  };
  const burst = (items, common = {}) => {
    const id = N.netId(), at = sharedNow() + lead(common);
    const seeded = items.map((it, i) => ({ ...it, seed: it.seed ?? `net:${id}:${i}` }));
    emit({ t: "letr", v: 1, op: "burst", id, at, scene: sceneId(),
      items: seeded.map((it) => ({ ...N.wireOpts(it, N.OP_KEYS, warnOnce), text: String(it.text ?? "").slice(0, N.MAX_TEXT) })), common: N.wireOpts(common, N.OP_KEYS, warnOnce) });
    const hs = L.burst(seeded.map((it) => ({ ...it, delay: lead(common) + (it.delay > 0 ? it.delay : 0) })), common);
    hs.forEach((h) => (h.netId = id)); keep(id, hs);
    return hs;
  };
  const stream = (o = {}) => {
    const id = N.netId(), seed = o.seed ?? `net:${id}`, at = sharedNow() + lead(o);
    emit({ t: "letr", v: 1, op: "stream", id, at, scene: sceneId(), opts: N.wireOpts({ ...o, seed }, [...N.OP_KEYS, ...N.STREAM_KEYS], warnOnce) });
    const s = L.stream({ ...o, seed, delay: lead(o) });
    s.netId = id; keep(id, s);
    return s;
  };
  const stop = (id, o = {}) => { emit({ t: "letr", v: 1, op: "stop", id, quick: !!o.quick }); stopLocal(id, o); };
  return { play, burst, stream, stop, sharedNow, local: (sharedT) => N.localStart(sharedT, sharedNow(), performance.now()), lead: 120 };
}
function keep(id, x) {
  state.net.set(id, x);
  if ( state.net.size > 200 ) state.net.delete(state.net.keys().next().value);
  const fin = Array.isArray(x) ? Promise.allSettled(x.map((h) => h.finished)) : x.finished;
  fin?.then?.(() => state.net.delete(id));
}
function stopLocal(id, o) { const x = state.net.get(id); if ( !x ) return; if ( Array.isArray(x) ) x.forEach((h) => h.stop(o)); else x.stop(o); }

function onSocket(raw, senderId) {
  const m = N.checkMsg(raw);
  if ( !m || !state.engine ) return;
  if ( senderId && !state.gate(senderId, Date.now()) ) return;
  const L = state.engine;
  if ( m.op === "stop" ) { stopLocal(m.id, { quick: !!m.quick }); return; }
  const when = N.localStart(m.at, sharedNow(), performance.now());
  const world = (o) => o?.space === "world";
  const sameScene = m.scene == null || m.scene === sceneId();
  const back = (w) => { const b = N.unwire(w, findToken); return N.missingToken(w, b) ? null : b; };
  try {
    if ( m.op === "play" ) {
      if ( world(m.opts) && !sameScene ) return;
      const o = back(m.opts); if ( !o ) return;
      const h = L.play(m.text, { ...o, ...when, delay: (when.delay ?? 0) + (o.delay ?? 0) || undefined });
      h.netId = m.id; keep(m.id, [h]);
    } else if ( m.op === "burst" ) {
      if ( world(m.common) && !sameScene ) return;
      const common = back(m.common) ?? {};
      const items = m.items.map((it) => (world({ ...m.common, ...it }) && !sameScene ? null : back(it))).filter(Boolean);
      const hs = L.burst(items.map((it) => ({ ...it, ...(when.delay != null ? { delay: when.delay + (it.delay ?? 0) } : { startAt: when.startAt + (it.delay ?? 0) }) })), common);
      keep(m.id, hs);
    } else if ( m.op === "stream" ) {
      if ( world(m.opts) && !sameScene ) return;
      const o = back(m.opts); if ( !o ) return;
      const s = L.stream({ ...o, ...(when.delay != null ? { delay: when.delay } : { startAt: when.startAt }) });
      keep(m.id, s);
    }
  } catch ( e ) { console.warn(`${LOG} net word failed`, e); }
}

/* ---------- GM: letter this now ---------- */
/* at the selected tokens (one word each, different hands) or at a world point (the cursor), shown to everyone */
function letterNow(text, opts = {}) {
  const L = state.engine;
  if ( !game.user.isGM ) { ui.notifications?.warn(t("Now.Hint")); return []; }
  const tokens = opts.tokens ?? (globalThis.canvas?.tokens?.controlled ?? []).map((x) => x.document);
  const { tokens: _x, point, ...rest } = opts;
  if ( tokens.length ) {
    const common = { space: "world", ...rest };
    if ( tokens.length === 1 ) return [L.net.play(text, { ...common, at: tokens[0] })];
    return L.net.burst(tokens.map((d) => ({ text, at: d })), common);
  }
  const p = point ?? cursorPoint();
  if ( p ) return [L.net.play(text, { space: "world", ...rest, at: { x: p.x, y: p.y } })];
  return [L.net.play(text, { ...rest, space: "screen" })];
}
export function cursorPoint() {
  const c = globalThis.canvas;
  if ( !c?.ready ) return null;
  const m = c.mousePosition;
  if ( m && Number.isFinite(m.x) ) return { x: m.x, y: m.y };
  return { x: c.stage.pivot.x, y: c.stage.pivot.y };
}

/* ---------- windows (loaded on first use) ---------- */
const ui$ = () => import("./ui.mjs");
async function openDesigner(o = {}) { if ( !game.user.isGM ) return null; return (await ui$()).openDesigner(state, o); }
async function openSettings() { return (await ui$()).openSettings(state); }
async function openNow() { if ( !game.user.isGM ) return; return (await ui$()).openNow(state); }

/* ---------- init: called once, by the newest copy ---------- */
export function init(REG) {
  state.host = hostId();
  Hooks.once("i18nInit", mergeStrings);
  registerSettings();
  game.keybindings.register(state.host, "letterNow", { name: "LETR.Now.Name", hint: "LETR.Now.Hint", restricted: true,
    editable: [{ key: "KeyL", modifiers: ["Shift"] }], onDown: () => { openNow(); return true; } });
  Hooks.on("getSceneControlButtons", (controls) => {
    if ( !game.user?.isGM ) return;
    const tok = controls.tokens ?? controls.token;
    if ( !tok?.tools ) return;
    tok.tools.moinenLetters = { name: "moinenLetters", order: 90, title: "LETR.Designer.Open", icon: "fa-solid fa-burst", button: true, visible: true,
      onChange: () => openDesigner() };
  });
  Hooks.once("setup", () => {
    readPrefs();
    syncStyles();
    REG.engine();                         // created now (fonts load in the background), so the filters are on before the first word
    install(REG._engine);
  });
  Hooks.once("ready", () => {
    game.socket?.on(channel(), onSocket);
    syncStyles();
    document.addEventListener("pointermove", (e) => { state.mouse = { x: e.clientX, y: e.clientY }; }, { passive: true });
  });
}
