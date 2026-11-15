/* LETR tools (contract v6): the engine's own settings, authoring API, networking helper, accessibility and windows, ONCE for every
   caller, whichever module(s) carry the engine. Both copies of scripts/letters/ import this file (index.mjs); at `init` the copy with
   the highest VERSION wins (one registration), exactly like the engine itself.

   Where things live (stable whichever module is active):
   - settings: namespace "moinen-letters", ALL world settings written by a GM (ENGTABLE 1.9.16: `table` = every preference of the table,
     `movement`, `face`, `styles`, `tableMigrated`); no client setting. A seat's own reduced motion and Foundry photosensitive mode still
     apply on that seat (prefs.seatPrefs). They are not listed
     in Foundry's settings window themselves (a namespace that is not a package lands in "Unmapped"); a menu button "Lettering
     settings" in the HOST module's tab opens the engine's own settings window. Host = moinen-maps when active, else
     invincible-plus-ultra (same on every client: module activation is per world).
   - socket: the host module's channel ("module.<host>"), messages { t: "letr", ... } (the modules' own listeners ignore them).
   - networking is GM only (TOOL-8): players' clients do not send and every client refuses a word from a non-GM sender.
   - keybinding "Letter this now" (GM, Shift+L, editable) and the designer button in the token controls: under the host module.
   Engine API added here (README "Tools"): L.prefs, L.settings(), L.registerMood/Palette/Font/Style, L.styles, L.saveStyle,
   L.deleteStyle, L.net.{play,burst,stream,stop,sharedNow,local}, L.letterNow, L.designer(), L.openSettings(), L.planFor. */
import { TABLE, TABLE_OBJECT, TABLE_DEFAULTS, cleanTable, seatPrefs, resolveOpts, filterPlan } from "./prefs.mjs";
import { STRINGS } from "./strings.mjs";
import * as A from "./author.mjs";
import * as N from "./net.mjs";
import { COLORS, TICK, MOODS, MOOD_IDS } from "./design.mjs";
import { makeClock } from "./clock.mjs";
import { sameBuild } from "./registry.mjs";

export const NS = "moinen-letters";
const LOG = "LETR |";
export const state = {
  prefs: seatPrefs(TABLE_DEFAULTS, {}), table: { ...TABLE_DEFAULTS }, seat: { osReduced: false, photosensitive: false }, styles: A.makeStyles(), fromWorld: new Set(), flashLog: [], host: null, engine: null, base: null,
  live: null, liveQ: [], liveT: 0, gate: N.rateGate(30), net: new Map(), warned: new Set(),
  /* ENGREG: the table's clock (clock.mjs; Foundry's serverTime until the first answer) and the builds the seats run */
  clock: makeClock({ ping: (cb) => game.socket.emit("time", (t) => cb(t?.serverTime)), fallback: () => globalThis.game?.time?.serverTime }),
  seats: new Map(), helloGate: N.rateGate(4), reg: null
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
      capPx, vh, preview: !!h?.still, impacts: state.impactWins });
  });
  ext.start.push(announce);
  /* ENGREG: L.measure gets this seat's settings like planFor (no flash budget touched) */
  ext.preview?.push((plan, o) => filterPlan(plan, o ?? {}, { prefs: state.prefs, colors: COLORS, TICK, flashLog: [], preview: true, capPx: 0, vh: 1 }));
  /* a stream with a style: the style's mood, palette, colours and motion under the stream's own options (one hand for all syllables) */
  const stream0 = L.stream;
  L.stream = (o = {}) => {
    const st = typeof o?.style === "string" ? state.styles.get(o.style) : null;
    if ( !st ) return stream0(o);
    const { label, hand, font, sound, ...rest } = st;
    return stream0({ ...rest, ...o, style: undefined });
  };
  applyLimits();
  /* MODE: the stepped grid on the world's shared clock (every seat draws on the same instants) */
  L.gridClock?.(gridOffset);
  Object.defineProperty(L, "moods", { configurable: true, enumerable: true, get: () => MOOD_IDS.map((id) => ({ id, label: MOODS[id].label, sound: { ...MOODS[id].sound }, custom: !!MOODS[id].custom })) });
  Object.defineProperty(L, "prefs", { configurable: true, enumerable: true, get: () => ({ ...state.prefs }) });
  /* ENGTABLE: the table's values as the GM chose them (L.prefs = what THIS seat applies: the table with the seat's own accessibility
     signals) and those signals themselves */
  Object.defineProperty(L, "table", { configurable: true, enumerable: true, get: () => ({ ...state.table }) });
  Object.defineProperty(L, "seat", { configurable: true, enumerable: true, get: () => ({ ...state.seat }) });
  Object.assign(L, {
    settings: () => ({ ...state.prefs }),
    /* ENGTABLE: the GM changes the table's preferences (every seat follows on its next word); a player's call is refused (false) */
    setTable,
    registerMood: A.registerMood, registerPalette: A.registerPalette,
    registerFont: (id, def) => A.registerFont(id, def, L._bank),
    registerStyle: (name, style) => state.styles.register(name, style),
    unregisterStyle: (name) => state.styles.remove(name),
    styles: () => state.styles.list(), style: (name) => state.styles.get(name),
    saveStyle, deleteStyle,
    palettes: () => Object.keys(COLORS), motionNames: A.motionNames,
    net: netApi(L),
    letterNow, designer: openDesigner, openSettings, planFor: (text, opts) => planFor(L, text, opts),
    /* ENGREG: the table's clock, the same instant on every seat (server ms): now(), toPage(serverMs) -> this page's performance.now(),
       toServer(pageMs), offset(), error() (ms, the bound of this seat's error), ready(), state() */
    clock: Object.freeze({ now: () => state.clock.serverNow(), toPage: (s) => state.clock.toPage(s), toServer: (p) => state.clock.toServer(p),
      offset: () => state.clock.offset(), error: () => state.clock.error(), ready: () => state.clock.ready(), state: () => state.clock.state() }),
    /* ENGREG: the engine build each seat runs ([{ user, name, gm, version, hash, module, same }]: same = the GM's build); a seat that
       runs another build than the GM's is named on the GM's seat and on its own */
    seats: () => seatsList()
  });
  return L;
}
function applyLimits() { applyPrefs(state.engine, state.prefs); }
/* the preferences the engine holds itself: word limits, and (MODE) the table's motion type and (FONTSEL) face for the invincible style. Read on every
   change of a setting (Foundry's onChange on each client), so a GM's switch reaches every seat's next word without a reload; words
   already playing keep the motion they started with. */
export function applyPrefs(L, prefs) {
  if ( !L ) return;
  L.limits.screen = prefs.limitScreen; L.limits.world = prefs.limitWorld;
  if ( prefs.movement && typeof L.motionMode === "function" ) L.motionMode(prefs.movement);
  if ( prefs.face && typeof L.invFace === "function" ) L.invFace(prefs.face);   // FONTSEL: the table's face, live on every seat
}

/* the plan this client would show for a call (designer preview): style, preferences and filters, without touching the flash budget */
export function planFor(L, text, opts = {}) {
  const o = resolveOpts({ ...opts, force: true }, state.prefs, state.styles.table, { osReduced: osReduced() });
  const plan = L._plan(String(text ?? ""), o);
  L._settle(plan);
  filterPlan(plan, o, { prefs: state.prefs, colors: COLORS, TICK, flashLog: [], preview: true, capPx: 0, vh: 1 });
  return { plan, opts: o };
}

/* ---------- settings (ENGTABLE 1.9.16: every preference is the table's) ----------
   The owner: «wszystko mg wybiera dla stołu. wszystko». One world object `moinen-letters.table` (prefs.TABLE_OBJECT) plus the world
   settings `movement` and `face`; written only by a GM (setTable; a player's write is stopped on his seat), read by every seat, applied
   on every onChange to the next word. What a seat applies (state.prefs) = the table with that seat's own accessibility signals
   (prefs.seatPrefs: its system's reduced motion, Foundry's photosensitive mode); the photosensitivity guard is always on. */
const TABLE_KEY = "table", MIGRATED_KEY = "tableMigrated", MIGRATION = 1;
const NOTICE_LS = `${NS}.tableNotice`;   // localStorage: a player was told once that the GM now chooses (players cannot write the world)
/* ENGDROP (1.9.19): invincible-plus-ultra's old world copy of the lettering values (GMALL, plus-ultra 132-135). plus-ultra keeps no copy
   since UNMIRROR (it reads L.table, writes L.setTable); the engine reads the old copy's DOCUMENT only as a migration source (no
   registration needed) and, on a GM's seat that still runs an older plus-ultra, takes what that older window writes (adoptOld). */
const PU_KEY = "invincible-plus-ultra.lettersTable";
const has = (id) => { try { return !!globalThis.game?.settings?.settings?.has?.(id); } catch { return false; } };
const getS = (k, d) => { try { return game.settings.get(NS, k); } catch { return d; } };
const photosensitive = () => { try { return has("core.photosensitiveMode") && !!game.settings.get("core", "photosensitiveMode"); } catch { return false; } };
export const seatNow = () => ({ osReduced: osReduced(), photosensitive: photosensitive() });
const sameV = (a, b) => a === b || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-9);
const sameT = (a, b, keys = TABLE_OBJECT) => keys.every((k) => sameV(a?.[k], b?.[k]));
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && k in o).map((k) => [k, o[k]]));

/* the table as stored in the world (the object + movement + face), cleaned */
function readTable() {
  const obj = getS(TABLE_KEY, null);
  return cleanTable({ ...(obj && typeof obj === "object" ? obj : {}), movement: getS("movement"), face: getS("face") });
}
export function readPrefs() {
  state.table = readTable();
  state.seat = seatNow();
  state.prefs = seatPrefs(state.table, state.seat);
  applyLimits();
  try { globalThis.Hooks?.callAll?.("moinenLettersTable", { ...state.table }, { ...state.seat }); } catch {}
  refreshWindow();
}
/* the GM writes the table (only what changed: one write for the object, one per older key); a player's call writes nothing, is refused */
export async function setTable(values = {}) {
  if ( !isGM() ) { refuseSet(); return false; }
  const next = cleanTable({ ...state.table, ...(values ?? {}) });
  const stored = getS(TABLE_KEY, null);
  if ( !sameT(next, cleanTable(stored && typeof stored === "object" ? stored : {})) ) await game.settings.set(NS, TABLE_KEY, pick(next, TABLE_OBJECT));
  for ( const k of ["movement", "face"] ) if ( getS(k) !== next[k] ) await game.settings.set(NS, k, next[k]);
  readPrefs();
  return true;
}
/* the windows' older name (1.9.2 .. 1.9.14) */
export const setPrefs = setTable;
function refuseSet() {
  const k = "set:refused"; if ( state.warned.has(k) ) return; state.warned.add(k);
  console.warn(`${LOG} the lettering settings are the table's: only a GM changes them (refused on this seat, nothing written)`);
  try { globalThis.ui?.notifications?.info(t("Settings.Refused")); } catch {}
}
/* a player's direct write of one of our world settings (a macro, an older module's mirror) is stopped on his seat before it is sent,
   quietly (Foundry's server refuses it anyway, with an error on his screen) */
function guardWrite(doc) {
  const key = doc?.key ?? doc?._source?.key;
  if ( typeof key !== "string" || !key.startsWith(`${NS}.`) || isGM() ) return;
  refuseSet();
  return false;
}

/* MIGRATION (once per world, by the first GM seat after the update): the GM's own earlier choices become the table's, unless the
   world already holds a table. Source, in order: invincible-plus-ultra's old copy (`lettersTable`, GMALL: the GM's choices for the table
   made in its window), read from its world DOCUMENT (whether or not any plus-ultra registers it: a world never opened since that copy
   keeps it, with or without plus-ultra active), else the GM's own old client values (localStorage "moinen-letters.<key>"). An old
   "full" motion becomes "auto" (full unless a seat asks for less); the old photosensitivity switch is dropped (the guard is always
   on). Players' old values are not taken: they stay in their browsers, unused; a player whose old values differed is told once. */
function rawLocal(id) {
  try { const raw = globalThis.localStorage?.getItem(id); if ( raw == null ) return undefined; try { return JSON.parse(raw); } catch { return raw; } } catch { return undefined; }
}
const worldDoc = (id) => { try { return game.settings.storage?.get("world")?.getSetting?.(id, null) ?? null; } catch { return null; } };
/* a Setting document's value as an object (v14 holds it parsed; an older store or a hand-made one may hold the JSON text) */
const docObject = (doc) => { let v = doc?.value; if ( typeof v === "string" ) { try { v = JSON.parse(v); } catch { return null; } } return v && typeof v === "object" ? v : null; };
/* this browser's old per-seat values (1.9.14 and before), as stored */
export function legacyValues() {
  const o = {};
  for ( const k of TABLE_OBJECT ) { const v = rawLocal(`${NS}.${k}`); if ( v !== undefined ) o[k] = v; }
  return o;
}
export async function migrate() {
  const out = { wrote: false, from: null, keys: [] };
  if ( !isGM() ) return out;
  let done = 0; try { done = Number(game.settings.get(NS, MIGRATED_KEY)) || 0; } catch { return out; }
  if ( done >= MIGRATION ) return out;
  if ( !worldDoc(`${NS}.${TABLE_KEY}`) ) {
    let src = null, from = null;
    const pu = docObject(worldDoc(PU_KEY));
    if ( pu ) { src = pick(pu, TABLE_OBJECT); from = "plus-ultra"; }
    else { src = legacyValues(); from = "gm"; }
    const next = cleanTable({ ...TABLE_DEFAULTS, ...src });
    const keys = TABLE_OBJECT.filter((k) => !sameV(next[k], TABLE_DEFAULTS[k]));
    if ( keys.length ) {
      await game.settings.set(NS, TABLE_KEY, pick(next, TABLE_OBJECT));
      Object.assign(out, { wrote: true, from, keys });
      console.info(`${LOG} the ${from === "gm" ? "GM's own" : "plus-ultra table's"} lettering choices became the table's: ${keys.join(", ")}`);
    }
  }
  await game.settings.set(NS, MIGRATED_KEY, MIGRATION);
  readPrefs();
  return out;
}
/* a player's seat: told once (per browser) when his own old values differ from the table */
export function noticeOnce() {
  try {
    if ( isGM() ) return false;
    const ls = globalThis.localStorage; if ( !ls || ls.getItem(NOTICE_LS) !== null ) return false;
    const mine = legacyValues();
    const differ = Object.keys(mine).some((k) => !sameV(cleanTable({ ...state.table, [k]: mine[k] })[k], state.table[k]));
    ls.setItem(NOTICE_LS, String(Date.now()));
    if ( differ ) globalThis.ui?.notifications?.info(t("Settings.Moved"));
    return differ;
  } catch { return false; }
}

/* AN OLDER invincible-plus-ultra next to this engine (ENGDROP-1: plus-ultra 132-135, before UNMIRROR, still runs its GMALL mirror).
   Its mirror writes the engine's old CLIENT settings, none of which is registered since 1.9.16: inert on every seat, so every seat
   applies the engine's table and no seat is left on other values. Its own window still writes its old copy `lettersTable`; on the GM's
   seat that wrote it, the keys that write CHANGED become the table's (setTable), so a choice made there is not lost. Nothing is written
   back into that copy (the engine keeps no mirror), so that older window can show older values: the GM is told once per session to
   update plus-ultra. plus-ultra 136+ never writes the copy and registers it only while the engine has not migrated (its own carry). */
const isReady = () => !!globalThis.game?.ready;
const old = { last: null, said: false, seen: false };
function oldPlusUltraAtSetup() {
  /* registered by a plus-ultra while the engine had migrated already (or with no copy in the world): a plus-ultra before 136 */
  try { let m = worldDoc(`${NS}.${MIGRATED_KEY}`)?.value; if ( typeof m === "string" ) m = Number(m);
    old.seen = has(PU_KEY) && (Number(m) >= 1 || !worldDoc(PU_KEY)); } catch { old.seen = false; }
  old.last = docObject(worldDoc(PU_KEY));
}
function sayOld() {
  if ( old.said || !isGM() ) return; old.said = true;
  console.warn(`${LOG} an older invincible-plus-ultra runs next to this engine: its "Comic effects" window still reaches the table, but may show older lettering values. Update invincible-plus-ultra.`);
  try { globalThis.ui?.notifications?.warn(t("Settings.OldPlusUltra")); } catch {}
}
function adoptOld(doc, _change, _options, userId) {
  if ( (doc?.key ?? doc?._source?.key) !== PU_KEY || !isReady() || !isGM() || (userId != null && userId !== game.user?.id) ) return;
  const next = docObject(doc); if ( !next ) return;
  const prev = cleanTable(old.last ?? {}), now = cleanTable({ ...TABLE_DEFAULTS, ...next });
  old.last = next;
  const keys = TABLE_OBJECT.filter((k) => k in next && !sameV(now[k], prev[k]) && !sameV(now[k], state.table[k]));
  sayOld();
  if ( keys.length ) setTable(pick(now, keys)).catch((e) => console.warn(`${LOG} older plus-ultra`, e));
}
/* the settings window open on this seat follows the table (a player's at once; a GM's while he has not started editing) */
function refreshWindow() { try { if ( state.settingsApp?.rendered ) state.settingsApp.follow?.(); } catch {} }

function registerSettings() {
  const type = { bool: Boolean, num: Number, pick: String };
  game.settings.register(NS, TABLE_KEY, { scope: "world", config: false, type: Object, default: pick(TABLE_DEFAULTS, TABLE_OBJECT), onChange: () => readPrefs() });
  for ( const k of ["movement", "face"] ) {
    const d = TABLE[k];
    game.settings.register(NS, k, { name: `LETR.Settings.${k}.Name`, hint: `LETR.Settings.${k}.Hint`, scope: "world", config: false,
      type: type[d.type], default: d.default, onChange: () => readPrefs() });
  }
  game.settings.register(NS, MIGRATED_KEY, { scope: "world", config: false, type: Number, default: 0 });
  game.settings.register(NS, "styles", { scope: "world", config: false, type: Object, default: {}, onChange: () => syncStyles() });
  /* a reset deletes a world setting's document: Foundry calls no onChange then */
  Hooks.on("deleteSetting", (doc) => { const k = doc?.key ?? ""; if ( k.startsWith(`${NS}.`) ) readPrefs(); });
  Hooks.on("preCreateSetting", guardWrite);
  Hooks.on("preUpdateSetting", guardWrite);
  for ( const h of ["createSetting", "updateSetting"] ) Hooks.on(h, adoptOld);
  Hooks.on("clientSettingChanged", (key) => { if ( key === "core.photosensitiveMode" ) readPrefs(); });
  try { globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.addEventListener?.("change", () => readPrefs()); } catch {}
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
  /* LM: a word this user does not see (a hidden token's word for a player, a token out of sight) is not read either: the engine
     placed it (and decided h.seen) before this start hook runs */
  if ( h.seen === false ) return;
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
/* ENGREG (1.9.11): the shared clock is the engine's own minimum-filter clock (clock.mjs) once it has an answer; before that Foundry's
   game.time.serverTime as before */
const sharedNow = () => state.clock.serverNow();
/* MODE: shared clock minus this page's clock, for the stepped grid. ENGREG: the clock's own offset (it changes only when a better
   answer comes or the clock jumped). Before the first answer: serverTime minus performance.now(), which ticks in whole ms and jitters
   by about 1 ms: kept until it drifts by more than 4 ms */
let gridOff0 = null;
function gridOffset() {
  const o = state.clock.offset();
  if ( o != null ) return o;
  const v = sharedNow() - performance.now();
  if ( gridOff0 == null || Math.abs(v - gridOff0) > 4 ) gridOff0 = v;
  return gridOff0;
}
function warnOnce(key) { if ( state.warned.has(key) ) return; state.warned.add(key); console.warn(`${LOG} net: "${key}" cannot travel to other clients (a function, a Promise or an element); it is left out there`); }
const sceneId = () => globalThis.canvas?.scene?.id ?? null;
function findToken(id) { return globalThis.canvas?.tokens?.get?.(id)?.document ?? null; }
const isGM = () => !!globalThis.game?.user?.isGM;
/* GM only (TOOL-8): a player's client never sends; it says so once on the console and gets a handle that is already over */
function refuse(what) {
  const k = `gm:${what}`; if ( state.warned.has(k) ) return; state.warned.add(k);
  console.warn(`${LOG} ${what}: only a GM shows lettering to everyone; refused on this client (nothing sent). L.play shows a word on this client only.`);
}
function emit(msg) { try { game.socket.emit(channel(), msg); } catch ( e ) { console.warn(`${LOG} net`, e); } }

function netApi(L) {
  const lead = (o) => (Number.isFinite(o?.lead) ? Math.max(0, Math.min(2000, o.lead)) : 120);
  const play = (text, opts = {}) => {
    if ( !isGM() ) { refuse("L.net.play"); return N.refusedHandle(text); }
    const id = N.netId(), seed = opts.seed ?? `net:${id}`, at = sharedNow() + lead(opts) + (opts.delay > 0 ? opts.delay : 0);
    const wire = N.wireOpts({ ...opts, seed, delay: undefined }, N.OP_KEYS, warnOnce);
    emit({ t: "letr", v: 1, op: "play", id, at, scene: sceneId(), text: String(text ?? "").slice(0, N.MAX_TEXT), opts: wire });
    const h = L.play(text, { ...opts, seed, delay: lead(opts) + (opts.delay > 0 ? opts.delay : 0) });
    h.netId = id; keep(id, [h]);
    return h;
  };
  const burst = (items, common = {}) => {
    if ( !isGM() ) { refuse("L.net.burst"); return []; }
    if ( !Array.isArray(items) ) return [];
    const id = N.netId(), at = sharedNow() + lead(common);
    const seeded = items.map((it, i) => ({ ...it, seed: it.seed ?? `net:${id}:${i}` }));
    emit({ t: "letr", v: 1, op: "burst", id, at, scene: sceneId(),
      items: seeded.map((it) => ({ ...N.wireOpts(it, N.OP_KEYS, warnOnce), text: String(it.text ?? "").slice(0, N.MAX_TEXT) })), common: N.wireOpts(common, N.OP_KEYS, warnOnce) });
    const hs = L.burst(seeded.map((it) => ({ ...it, delay: lead(common) + (it.delay > 0 ? it.delay : 0) })), common);
    hs.forEach((h) => (h.netId = id)); keep(id, hs);
    return hs;
  };
  const stream = (o = {}) => {
    if ( !isGM() ) { refuse("L.net.stream"); return N.refusedHandle(o?.text); }
    const id = N.netId(), seed = o.seed ?? `net:${id}`, at = sharedNow() + lead(o);
    emit({ t: "letr", v: 1, op: "stream", id, at, scene: sceneId(), opts: N.wireOpts({ ...o, seed }, [...N.OP_KEYS, ...N.STREAM_KEYS], warnOnce) });
    const s = L.stream({ ...o, seed, delay: lead(o) });
    s.netId = id; keep(id, s);
    return s;
  };
  const stop = (id, o = {}) => { if ( isGM() ) emit({ t: "letr", v: 1, op: "stop", id, quick: !!o.quick }); stopLocal(id, o); };
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
  /* ENGREG: a seat's build (any user may send it; it carries no word) */
  const hi = N.checkHello(raw);
  if ( hi ) { onHello(hi, senderId); return; }
  const m = N.checkMsg(raw);
  if ( !m || !state.engine ) return;
  /* GM only (TOOL-8): a word from a sender who is not a GM user is dropped (a modified client cannot push words) */
  if ( !N.senderIsGM(senderId, (id) => globalThis.game?.users?.get?.(id)) ) {
    const k = `from:${senderId}`;
    if ( !state.warned.has(k) ) { state.warned.add(k); console.warn(`${LOG} net: a lettering message from a non-GM user (${senderId ?? "unknown"}) was refused`); }
    return;
  }
  if ( !state.gate(senderId, Date.now()) ) return;
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

/* ---------- ENGREG: which build every seat runs ----------
   At ready every seat sends its build (version, content hash, module of the copy) once; the GM's seat answers a newcomer with its
   own. A player's seat compares with the GM's, the GM's seat with every player's: a different build is named once on that seat
   (console + notification), so the table never runs two engines' behaviour without anyone knowing. */
const myBuild = () => state.reg?.build ?? (state.engine ? { version: state.engine.version, hash: null, module: null } : null);
function sendHello(reply = false) {
  const b = myBuild(); if ( !b ) return;
  emit(N.helloMsg(b, globalThis.game?.user?.id, isGM(), reply));
}
function onHello(m, senderId) {
  if ( !senderId || senderId !== m.user || !state.helloGate(`h:${senderId}`, Date.now()) ) return;
  const u = globalThis.game?.users?.get?.(senderId), gm = !!u?.isGM;
  state.seats.set(senderId, { user: senderId, name: u?.name ?? senderId, gm, version: m.version, hash: m.hash, module: m.module, at: Date.now() });
  /* a newcomer gets the GM's build back (once per hello; the answer itself is not answered) */
  if ( isGM() && !m.reply ) sendHello(true);
  const mine = myBuild();
  if ( !mine || sameBuild(mine, m) ) return;
  if ( !(isGM() || gm) ) return;   // players compare only with the GM
  const k = `build:${senderId}:${m.version}:${m.hash}`;
  if ( state.warned.has(k) ) return; state.warned.add(k);
  const short = (b) => `${b.version}${b.hash ? ` (${String(b.hash).slice(0, 6)})` : ""}`;
  const text = t("Seats.Differ", { name: u?.name ?? senderId, theirs: short(m), mine: short(mine) });
  console.warn(`${LOG} ${text}`);
  try { globalThis.ui?.notifications?.warn(text); } catch {}
}
function seatsList() {
  const mine = myBuild(), me = globalThis.game?.user;
  const gmB = isGM() ? mine : [...state.seats.values()].find((s) => s.gm) ?? null;
  const rows = [{ user: me?.id ?? null, name: me?.name ?? null, gm: isGM(), version: mine?.version ?? null, hash: mine?.hash ?? null, module: mine?.module ?? null, self: true }];
  for ( const s of state.seats.values() ) if ( s.user !== me?.id ) rows.push({ ...s });
  return rows.map((r) => ({ ...r, same: gmB ? sameBuild(gmB, r) : null }));
}

/* for the node checks (check-tools.mjs): the sender and the receiver without Foundry */
export const _net = { netApi, onSocket, sendHello, seatsList, state };

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
  state.reg = REG;
  Hooks.once("setup", () => {
    oldPlusUltraAtSetup();                // ENGDROP: every module has registered its settings by now (plus-ultra at its init)
    readPrefs();
    syncStyles();
    const p = REG.engine();               // created now (fonts load in the background), so the filters are on before the first word
    if ( REG._engine ) install(REG._engine); else p?.then?.(() => install(REG._engine));   // ENGREG: a carrier still loading
  });
  Hooks.once("ready", () => {
    game.socket?.on(channel(), onSocket);
    state.clock.start();                  // ENGREG: the table's clock (a burst of "time" pings, then one every 10 s)
    setTimeout(() => sendHello(false), 500);
    syncStyles();
    /* ENGTABLE: the GM's seat migrates once; a player is told once. ENGDROP: an older plus-ultra on the GM's seat is named once */
    (async () => {
      try { if ( isGM() ) await migrate(); } catch ( e ) { console.warn(`${LOG} migration`, e); }
      if ( old.seen ) sayOld();
      noticeOnce();
    })();
    document.addEventListener("pointermove", (e) => { state.mouse = { x: e.clientX, y: e.clientY }; }, { passive: true });
  });
}
