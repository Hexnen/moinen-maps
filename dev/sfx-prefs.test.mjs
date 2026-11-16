// GMALLMAPS: every option of what the table SEES of the map's comic sound words is the TABLE's (owner, 2026-11-15: «wszystko mg wybiera
// dla stołu. wszystko»): world scope, written by a GM only, live on every seat, shown read-only to players, migrated so the GM loses
// nothing he had chosen. The real sfx.mjs runs on two fake seats (a GM and a player) that share one fake world store, with Foundry's
// own rules for settings: a world write fires onChange / createSetting / updateSetting on EVERY seat, a reset deletes the document
// (deleteSetting, no onChange), the server refuses a player's restricted write, a client value lives in that seat's localStorage.
//   SCOPE     no table key of the map lettering is registered with client scope (registration and every source file); the old seat
//             override "sfxWords" is not registered at all; the window's menu is open to players
//   GUARD     a player's write of each table key is cancelled on his own seat (and would be refused by the server); a GM's goes through
//   LIVE      a GM change of each table key reaches the player's seat at once (its status: mode, words, layer, sizes); a reset (delete)
//             brings every seat back to the default
//   MIGRATE   the GM's own old client values become the table's once (the old switch "for everyone" off wins; a world value already
//             there is kept; defaults write nothing; the marker stops a second run; a player's old values are never taken)
//   PURE      sfx-prefs: clean, tableOf, shareOf against the rule before GMALLMAPS
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; if ( process.env.PREFS_VERBOSE ) console.log("  ok", m); };
const failed = [];
const group = async (id, fn) => { try { await fn(); } catch ( err ) { failed.push(`${id}: ${String(err?.message ?? err).split(/\r?\n/)[0]}`); } };
const MOD = "moinen-maps";

/* ---------------------------------------------------------------- minimal Foundry around two seats */
const any = (name = "stub") => {
  const fn = function () {};
  return new Proxy(fn, {
    get(t, k) {
      if ( k === Symbol.toPrimitive ) return () => 0;
      if ( k === "then" ) return undefined;
      if ( k === Symbol.iterator ) return function* () {};
      if ( !(k in t) ) t[k] = any(`${name}.${String(k)}`);
      return t[k];
    },
    apply: () => any(`${name}()`), construct: () => any(`new ${name}`), set(t, k, v) { t[k] = v; return true; }
  });
};
globalThis.foundry = new Proxy({ utils: { deepClone: (o) => structuredClone(o), mergeObject: (a, b) => Object.assign(a, b), randomID: () => Math.random().toString(36).slice(2, 18) },
  applications: { api: { ApplicationV2: class { render() { return this; } } }, fields: any("fields"), ux: any("ux") } }, { get: (t, k) => (k in t ? t[k] : (t[k] = any(`foundry.${String(k)}`))) });
globalThis.CONFIG = new Proxy({}, { get: (t, k) => (t[k] ??= any(`CONFIG.${String(k)}`)) });
globalThis.CONST = any("CONST"); globalThis.PIXI = any("PIXI");
globalThis.canvas = new Proxy({ ready: false, scene: null, grid: { size: 100 }, stage: { scale: { x: 1, y: 1 } } }, { get: (t, k) => (k in t ? t[k] : (t[k] = any(`canvas.${String(k)}`))) });
globalThis.document = new Proxy({ addEventListener() {}, removeEventListener() {}, createElement: () => any("el"), querySelector: () => null, querySelectorAll: () => [] }, { get: (t, k) => (k in t ? t[k] : (t[k] = any(`document.${String(k)}`))) });
globalThis.window = globalThis;
globalThis.addEventListener ??= () => {}; globalThis.removeEventListener ??= () => {};
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });

const world = new Map();          // key -> Setting document { key, value, _stats }
const seats = [];
const notes = [];
function makeSeat(name, isGM, local = {}, { lang = "en", active = isGM } = {}) {
  const hooks = new Map(), reg = new Map(), store = new Map(Object.entries(local).map(([k, v]) => [`${MOD}.${k}`, JSON.stringify(v)]));
  const S = { name, isGM, hooks, reg, store, menus: new Map(), sfx: null };
  S.Hooks = {
    on(h, fn) { if ( !hooks.has(h) ) hooks.set(h, []); hooks.get(h).push(fn); return 1; },
    once(h, fn) { return S.Hooks.on(h, fn); }, off() {},
    callAll(h, ...a) { for ( const fn of hooks.get(h) ?? [] ) fn(...a); return true; },
    call(h, ...a) { for ( const fn of hooks.get(h) ?? [] ) if ( fn(...a) === false ) return false; return true; }
  };
  const getOf = (id) => {
    const c = reg.get(id); if ( !c ) throw new Error(`not registered ${id}`);
    if ( c.scope === "world" ) { const d = world.get(id); return d ? d.value : structuredClone(c.default); }
    const raw = store.get(id); return raw === undefined ? structuredClone(c.default) : JSON.parse(raw);
  };
  S.game = {
    user: { id: `${name}-id`, isGM, isActiveGM: active, can: () => isGM },
    i18n: { lang, localize: (k) => k, format: (k) => k, has: () => true },
    modules: new Map([[MOD, { id: MOD, active: true, api: {} }]]), keybindings: { register() {} },
    settings: {
      settings: reg,
      register(m, k, cfg) { reg.set(`${m}.${k}`, { ...cfg, key: k, namespace: m }); },
      registerMenu(m, k, cfg) { S.menus.set(`${m}.${k}`, cfg); },
      get(m, k) { return getOf(`${m}.${k}`); },
      async set(m, k, v) { return writeSetting(S, `${m}.${k}`, v); },
      storage: new Map([["world", { getSetting: (id) => world.get(id) ?? null }]])
    }
  };
  S.ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  S.ui = { notifications: { warn: (m) => notes.push([name, "warn", m]), info: (m) => notes.push([name, "info", m]), error: (m) => notes.push([name, "error", m]) } };
  seats.push(S);
  return S;
}
let cur = null;
function enter(S) { cur = S; globalThis.game = S.game; globalThis.Hooks = S.Hooks; globalThis.localStorage = S.ls; globalThis.ui = S.ui; }
function on(S, fn) { const prev = cur; enter(S); try { return fn(); } finally { if ( prev ) enter(prev); } }
/** Foundry's path of a world setting write: the pre-hook on the writing seat (false cancels it there: a cancelled create throws, a
    cancelled update returns the value as it is), the server's permission (a restricted key needs SETTINGS_MODIFY), then the document on
    every seat: its create / update hook and the setting's onChange */
async function writeSetting(S, id, value) {
  const c = S.reg.get(id); if ( !c ) throw new Error(`not registered ${id}`);
  if ( c.scope !== "world" ) { S.store.set(id, JSON.stringify(value)); c.onChange?.(value); return value; }
  const had = world.get(id), doc = { key: id, value: structuredClone(value), _stats: { modifiedTime: Date.now() } };
  const pre = on(S, () => S.Hooks.call(had ? "preUpdateSetting" : "preCreateSetting", had ?? doc, { key: id, value }, {}, S.game.user.id));
  if ( pre === false ) { if ( !had ) throw new TypeError("Cannot read properties of undefined (reading 'value')"); return had.value; }
  if ( c.restricted && !S.isGM ) { on(S, () => S.ui.notifications.error("server: permission denied")); throw new Error("refused by the server"); }
  world.set(id, doc);
  for ( const T of seats ) on(T, () => { T.Hooks.callAll(had ? "updateSetting" : "createSetting", doc, { value }, {}, S.game.user.id); T.reg.get(id)?.onChange?.(doc.value); });
  return doc.value;
}
/** a reset: the GM deletes the document (every seat: deleteSetting, no onChange) */
function deleteSetting(id) { const d = world.get(id); if ( !d ) return; world.delete(id); for ( const T of seats ) on(T, () => T.Hooks.callAll("deleteSetting", d, {}, "gm-id")); }

const PF = await import(pathToFileURL(path.join(root, "scripts/sfx/sfx-prefs.mjs")).href);
const SZ = await import(pathToFileURL(path.join(root, "scripts/sfx/sfx-size.mjs")).href);
let seatNo = 0;
/** boot a seat: its own copy of sfx.mjs (module state per seat), init then ready */
async function boot(S) {
  enter(S);
  const m = await import(pathToFileURL(path.join(root, "scripts/sfx/sfx.mjs")).href + `?seat=${++seatNo}`);
  S.sfx = m;
  m.registerSfx();
  S.Hooks.callAll("init");
  for ( const fn of S.hooks.get("ready") ?? [] ) await fn();
  return S;
}
const status = (S) => on(S, () => S.sfx.sfxApi.status());
const reset = () => { world.clear(); seats.length = 0; notes.length = 0; cur = null; };
const KEYS = PF.TABLE_KEYS;

/* ---------------------------------------------------------------- SCOPE */
await group("SCOPE", async () => {
  reset();
  const gm = await boot(makeSeat("gm", true));
  for ( const k of KEYS ) {
    const c = gm.reg.get(`${MOD}.${k}`);
    ok(c && c.scope === "world" && c.restricted === true && c.config === false && typeof c.onChange === "function", `${k}: world, restricted (the GM's), live (onChange), shown in the table window (config false)`);
  }
  ok(!gm.reg.has(`${MOD}.sfxWords`), "the old seat override of the word set is not registered any more");
  const clientSfx = [...gm.reg.values()].filter((c) => c.scope === "client" && /^sfx/i.test(c.key));
  ok(clientSfx.length === 0, `no client setting of the map lettering remains (${clientSfx.map((c) => c.key).join(", ") || "none"})`);
  const menu = gm.menus.get(`${MOD}.sfxTable`);
  ok(menu && menu.restricted === false && typeof menu.type === "function", "one menu opens the table window, for players too (they read the table)");
  // (every source file: a moved key never registered client-side anywhere else)
  const walk = (d, out = []) => { for ( const f of fs.readdirSync(d) ) { const p = path.join(d, f); if ( fs.statSync(p).isDirectory() ) walk(p, out); else if ( /\.mjs$/.test(f) ) out.push(p); } return out; };
  const moved = [...KEYS, "sfxWords"];
  for ( const f of walk(path.join(root, "scripts")) ) {
    if ( f.includes(`${path.sep}letters${path.sep}`) ) continue;
    const t = fs.readFileSync(f, "utf8");
    for ( const m of t.matchAll(/settings\.register\(\s*MODULE_ID,\s*"([^"]+)",\s*\{[^}]*scope:\s*"client"/g) ) ok(!moved.includes(m[1]), `${path.relative(root, f)}: ${m[1]} is not a table key of the lettering`);
  }
});

/* ---------------------------------------------------------------- GUARD + LIVE */
const SAMPLE = { sfxLetters: "big", sfxWordsWorld: "pl", sfxLayer: "tokens", sfxSizeDestruction: 3, sfxSizeFire: 1, sfxSizeWeather: 0 };
const statusOf = (k, st) => ({ sfxLetters: st.mode, sfxWordsWorld: st.lang, sfxLayer: st.layer, sfxSizeDestruction: st.sizes.destruction, sfxSizeFire: st.sizes.fire, sfxSizeWeather: st.sizes.weather })[k];
await group("GUARD", async () => {
  reset();
  const gm = await boot(makeSeat("gm", true)), pl = await boot(makeSeat("player", false));
  world.delete(`${MOD}.sfxWordsWorld`);     // (the GM's seat fixed "game language" to English at ready: start this group on the defaults)
  for ( const k of KEYS ) {
    const before = status(pl);
    let threw = false;
    enter(pl);
    try { await pl.game.settings.set(MOD, k, SAMPLE[k]); } catch { threw = true; }
    ok(!world.has(`${MOD}.${k}`) && JSON.stringify(status(pl)) === JSON.stringify(before), `${k}: a player's write is cancelled (nothing stored, nothing changed)`);
    ok(threw || !world.has(`${MOD}.${k}`), `${k}: the write did not reach the world`);
  }
  const refused = notes.filter(([s, kind, m]) => s === "player" && kind === "warn" && m === "MOINENMAPS.Sfx.table.refused").length;
  ok(refused === KEYS.length && !notes.some(([, kind]) => kind === "error"), `the player is told why, once per try (${refused}), no server error`);
  enter(gm);
  for ( const k of KEYS ) { await gm.game.settings.set(MOD, k, SAMPLE[k]); ok(world.get(`${MOD}.${k}`)?.value === SAMPLE[k], `${k}: the GM's write is stored`); }
});
await group("LIVE", async () => {
  reset();
  const gm = await boot(makeSeat("gm", true)), pl = await boot(makeSeat("player", false));
  world.delete(`${MOD}.sfxWordsWorld`);
  const exp = { sfxLetters: "big", sfxWordsWorld: "pl", sfxLayer: "tokens", sfxSizeDestruction: 3, sfxSizeFire: 1, sfxSizeWeather: 0 };
  for ( const k of KEYS ) {
    enter(gm); await gm.game.settings.set(MOD, k, SAMPLE[k]);
    const st = status(pl);
    ok(statusOf(k, st) === exp[k], `${k} = ${SAMPLE[k]}: the player's seat letters by it at once (${statusOf(k, st)})`);
    ok(JSON.stringify(status(gm)) === JSON.stringify(st), `${k}: both seats apply the same table`);
  }
  // (the default again: the GM's "Defaults" + save writes them back; a document deleted by a macro / reset is the default too)
  for ( const k of KEYS ) deleteSetting(`${MOD}.${k}`);
  const d = status(pl);
  ok(d.mode === "all" && d.layer === "overlay" && d.lang === "en" && Object.values(d.sizes).every((v) => v === 2), `a reset brings the player's seat back to the defaults (${JSON.stringify({ mode: d.mode, layer: d.layer, lang: d.lang, sizes: d.sizes })})`);
  ok(JSON.stringify(status(gm)) === JSON.stringify(d), "and the GM's");
  // (the player's own old values in his browser change nothing)
  pl.store.set(`${MOD}.sfxLetters`, JSON.stringify("off")); pl.store.set(`${MOD}.sfxLayer`, JSON.stringify("top")); pl.store.set(`${MOD}.sfxWords`, JSON.stringify("pl"));
  const p2 = status(pl);
  ok(p2.mode === "all" && p2.layer === "overlay" && p2.lang === "en", "a player's old seat values (off, top, Polish) are not read: he letters the table's");
});

/* ---------------------------------------------------------------- MIGRATE */
async function migrateCase({ gmLocal = {}, worldBefore = {}, plLocal = {}, done = 0 }) {
  reset();
  for ( const [k, v] of Object.entries(worldBefore) ) world.set(`${MOD}.${k}`, { key: `${MOD}.${k}`, value: v });
  if ( done ) world.set(`${MOD}.${PF.MIGRATED_KEY}`, { key: `${MOD}.${PF.MIGRATED_KEY}`, value: done });
  const gm = await boot(makeSeat("gm", true, gmLocal)), pl = await boot(makeSeat("player", false, plLocal));
  return { gm, pl, st: status(pl), gst: status(gm) };
}
await group("MIGRATE", async () => {
  let r = await migrateCase({ gmLocal: { sfxLetters: "big", sfxLayer: "tokens", sfxWords: "pl" } });
  ok(r.st.mode === "big" && r.st.layer === "tokens" && r.st.lang === "pl", `the GM's own old choices become the table's: every seat (${r.st.mode}, ${r.st.layer}, ${r.st.lang})`);
  ok(world.get(`${MOD}.${PF.MIGRATED_KEY}`)?.value === PF.MIGRATION, "the world is marked migrated");
  ok(notes.some(([s, kind, m]) => s === "gm" && kind === "info" && m === "MOINENMAPS.Sfx.table.migrated"), "the GM is told his choices are the table's now");
  r = await migrateCase({ gmLocal: { sfxLetters: "big" }, worldBefore: { sfxLettersWorld: false } });
  ok(r.st.mode === "off", "the old world switch 'for everyone' off wins: lettering off on every seat");
  r = await migrateCase({ worldBefore: { sfxLettersWorld: true, sfxWordsWorld: "pl" } });
  ok(r.st.mode === "all" && r.st.lang === "pl" && !world.has(`${MOD}.sfxLetters`) && !world.has(`${MOD}.sfxLayer`), "defaults (and the world's own word set) write nothing and change nothing");
  ok(!notes.some(([, , m]) => m === "MOINENMAPS.Sfx.table.migrated"), "nothing taken: no notice");
  r = await migrateCase({ gmLocal: { sfxLayer: "top" }, worldBefore: { sfxLayer: "ground" } });
  ok(r.st.layer === "ground", "a value the world already holds is the table's: kept");
  r = await migrateCase({ gmLocal: { sfxLetters: "off" }, done: 1 });
  ok(r.st.mode === "all", "migrated once: a second run takes nothing");
  r = await migrateCase({ gmLocal: { sfxLayer: "nonsense", sfxLetters: 7 } });
  ok(r.st.layer === "overlay" && r.st.mode === "all" && !world.has(`${MOD}.sfxLayer`), "an unreadable old value is not taken");
  r = await migrateCase({ plLocal: { sfxLetters: "off", sfxLayer: "top", sfxWords: "pl" } });
  ok(r.st.mode === "all" && r.st.layer === "overlay" && !world.has(`${MOD}.sfxLetters`), "a player's old values are never taken");
  ok(notes.some(([s, kind, m]) => s === "player" && kind === "info" && m === "MOINENMAPS.Sfx.table.moved"), "the player whose old values differ is told once that the GM chooses now");
  const told = notes.length; await (async () => { enter(r.pl); for ( const fn of r.pl.hooks.get("ready") ?? [] ) await fn(); })();
  ok(!notes.slice(told).some(([, , m]) => m === "MOINENMAPS.Sfx.table.moved"), "... only once");
  r = await migrateCase({ gmLocal: { sfxWords: "en" } });
  ok(r.st.lang === "en", "a GM's own English word set becomes the table's (instead of the language fix at ready)");
});

/* ---------------------------------------------------------------- MIXED (MAPWIN, ADVM 11): seats in two interface languages letter ONE word set */
await group("MIXED", async () => {
  const C = await import(pathToFileURL(path.join(root, "scripts/sfx/sfx-core.mjs")).href);
  const langs = (...S) => S.map((q) => status(q).lang).join("/");
  const stored = () => world.get(`${MOD}.sfxWordsWorld`)?.value;
  ok(C.langOf("auto", "pl") !== C.langOf("auto", "en"), "the old resolution: 'game language' read per seat gives a Polish and an English seat two word sets");
  // a new world, the GM's interface Polish, the player's English
  reset();
  let gm = await boot(makeSeat("gm", true, {}, { lang: "pl" })), pl = await boot(makeSeat("player", false, {}, { lang: "en" }));
  ok(stored() === "pl" && langs(gm, pl) === "pl/pl", `a new world: the GM's seat names the set from its language, both seats letter it (${stored()}; ${langs(gm, pl)})`);
  // the GM's old window: Defaults + Save stored "game language"
  enter(gm); await gm.game.settings.set(MOD, "sfxWordsWorld", "auto");
  ok(stored() === "pl" && langs(gm, pl) === "pl/pl", `'game language' written (an older window's Defaults, a macro): named again at once (${stored()}; ${langs(gm, pl)})`);
  deleteSetting(`${MOD}.sfxWordsWorld`);
  ok(stored() === "pl" && langs(gm, pl) === "pl/pl", `the document deleted (a reset): named again at once (${stored()}; ${langs(gm, pl)})`);
  enter(gm); await gm.game.settings.set(MOD, "sfxWordsWorld", "en");
  ok(stored() === "en" && langs(gm, pl) === "en/en", "the GM's own choice stays (English on a Polish GM seat)");
  // the other way round, and a third seat
  reset();
  gm = await boot(makeSeat("gm", true, {}, { lang: "en" })); pl = await boot(makeSeat("player", false, {}, { lang: "pl" })); const p2 = await boot(makeSeat("player2", false, {}, { lang: "de" }));
  ok(stored() === "en" && langs(gm, pl, p2) === "en/en/en", `an English GM, a Polish and a German player: one set (${langs(gm, pl, p2)})`);
  // no seat may name the set (no active GM: players alone, or a second GM who is not the active one): 'game language' stays stored -
  // every seat still letters the same shared set, none its own language
  reset();
  const a = await boot(makeSeat("playerPl", false, {}, { lang: "pl" })), b = await boot(makeSeat("playerEn", false, {}, { lang: "en" })), g2 = await boot(makeSeat("gm2", true, {}, { lang: "pl", active: false }));
  ok(stored() === undefined && langs(a, b, g2) === `${PF.SHARED_WORDS}/${PF.SHARED_WORDS}/${PF.SHARED_WORDS}`, `nobody to name the set: every seat the shared one (${langs(a, b, g2)}), nothing written`);
  enter(g2); await g2.game.settings.set(MOD, "sfxWordsWorld", "auto");
  ok(stored() === "auto" && new Set([status(a).lang, status(b).lang, status(g2).lang]).size === 1, "'game language' stored with no active GM: still one set on every seat");
  ok(on(a, () => a.sfx.tableNow().lang) === on(b, () => b.sfx.tableNow().lang), "and the window's table (api.sfx.prefs) says the same on both");
  // the source: no seat's language in the runtime's resolution; the window offers the two sets only and its Defaults write nothing
  const sfx = fs.readFileSync(path.join(root, "scripts/sfx/sfx.mjs"), "utf8"), uiSrc = fs.readFileSync(path.join(root, "scripts/sfx/sfx-table-ui.mjs"), "utf8");
  ok(/^const lang = \(\) => PF\.wordsOf\(get\("sfxWordsWorld", "auto"\)\);$/m.test(sfx) && !/C\.langOf\(/.test(sfx), "sfx.mjs resolves the word set from the stored value alone");
  const lines = sfx.split(/\r?\n/).filter((l) => /i18n\??\.lang/.test(l));
  ok(lines.length === 2 && lines.every((l) => /PF\.wordsFor\(game\.i18n\?\.lang\)|guiLang: \(\) => game\.i18n\?\.lang/.test(l)), `the interface language is read only to NAME the set on a GM's seat (${lines.length} lines)`);
  ok(/const choicesOf = \(k\) => \(k === "sfxWordsWorld" \? PF\.WORD_SETS : PF\.TABLE\[k\]\.choices\);/.test(uiSrc) && !/wordsAuto|"Auto"/.test(uiSrc), "the window offers English / Polish only");
  const body = (name) => { const i = uiSrc.indexOf(`static ${name}(`), j = uiSrc.indexOf("\n", i); return uiSrc.slice(i, j); };
  ok(/this\.v = this\.defaults\(\); this\.render\(\);/.test(body("#reset")) && !/settings\.set/.test(body("#reset")) && !/settings\.set/.test(body("#discard")), "Defaults and Discard only fill the form: nothing is written before Save");
  ok(/save\.disabled = !this\.dirty;/.test(uiSrc) && /reset\.disabled = PF\.changedKeys\(edited, this\.defaults\(\)\)\.length === 0;/.test(uiSrc) && /role="status" aria-live="polite"/.test(uiSrc) && /mm-sfxt-was/.test(uiSrc),
    "the window says what is unsaved: a status line, the table's value on a changed row, Save only with a change, Defaults only when they differ");
  for ( const lg of ["en", "pl"] ) { const j = JSON.parse(fs.readFileSync(path.join(root, `lang/${lg}.json`), "utf8"));
    ok(["table.state.clean", "table.state.dirty", "table.state.dirtyOne", "table.was", "table.discard"].every((k) => typeof j[`MOINENMAPS.Sfx.${k}`] === "string") && /\{n\}/.test(j["MOINENMAPS.Sfx.table.state.dirty"]) && /\{value\}/.test(j["MOINENMAPS.Sfx.table.was"])
      && !("MOINENMAPS.Sfx.world" in j) && !("MOINENMAPS.Sfx.worldHint" in j) && !("MOINENMAPS.Sfx.words" in j), `lang/${lg}.json: the status strings are there, the removed settings' strings are gone`); }
});

/* ---------------------------------------------------------------- PURE */
await group("PURE", async () => {
  ok(PF.clean("sfxLetters", "x") === "all" && PF.clean("sfxLayer", "top") === "top" && PF.clean("sfxSizeFire", "9") === 3 && PF.clean("sfxSizeFire", null) === 2, "clean: illegal values fall back, sizes clamp");
  // (MAPWIN: nothing of the seat goes into the table - a word set no GM named yet is the shared one, whatever the seat's language)
  const t = PF.tableOf((k) => PF.TABLE[k].def, "pl");
  ok(t.mode === "all" && t.lang === PF.SHARED_WORDS && t.layer === "overlay" && JSON.stringify(t.steps) === JSON.stringify({ destruction: 2, fire: 2, weather: 2 }), "tableOf at the defaults (a word set not named yet: the shared one, not the interface's)");
  ok(PF.wordsOf("pl") === "pl" && PF.wordsOf("en") === "en" && PF.wordsOf("auto") === PF.SHARED_WORDS && PF.wordsOf(undefined) === PF.SHARED_WORDS && PF.wordsOf("de") === PF.SHARED_WORDS, "wordsOf: a named set, else the shared one");
  ok(PF.wordsFor("pl") === "pl" && PF.wordsFor("pl-PL") === "pl" && PF.wordsFor("en") === "en" && PF.wordsFor("de") === "en" && PF.wordsFor(undefined) === "en", "wordsFor: the GM's language names the set");
  const dp = PF.defaultsFor("pl"), de = PF.defaultsFor("en");
  ok(dp.sfxWordsWorld === "pl" && de.sfxWordsWorld === "en" && PF.TABLE_KEYS.every((k) => k === "sfxWordsWorld" || dp[k] === PF.TABLE[k].def) && !Object.values(dp).includes("auto"), "the window's Defaults: every default, the word set named from the GM's language, never 'game language'");
  const shown = PF.shownOf((k) => ({ sfxWordsWorld: "auto", sfxLetters: "nonsense", sfxSizeFire: 9 })[k] ?? PF.TABLE[k].def);
  ok(shown.sfxWordsWorld === PF.SHARED_WORDS && shown.sfxLetters === "all" && shown.sfxSizeFire === 3, "the window shows what every seat letters (legal values, the shared set while none is named)");
  ok(JSON.stringify(PF.changedKeys({ ...shown }, shown)) === "[]" && JSON.stringify(PF.changedKeys({ ...shown, sfxLayer: "top", sfxSizeFire: 1 }, shown)) === JSON.stringify(["sfxLayer", "sfxSizeFire"])
    && JSON.stringify(PF.changedKeys({ sfxLayer: shown.sfxLayer }, shown)) === "[]", "changedKeys: only the rows whose edited value differs from the table's");
  // (shareOf = the rule sfx.mjs flushMoment had inline before GMALLMAPS, on random moments)
  const C = await import(pathToFileURL(path.join(root, "scripts/sfx/sfx-core.mjs")).href);
  const old = (placed, big, caps, alive) => { let mine = big ? placed.filter((w) => w.role === "main" && (w.loud ?? 1) >= 0.2 + 0.8 * 0.34 - 1e-9) : placed;
    const secs = mine.filter((w) => w.role === "sec").sort((a, b) => a.t - b.t).slice(0, caps.sec); return C.capWords([...mine.filter((w) => w.role !== "sec"), ...secs], caps.alive - alive); };
  let same = 0, cases = 0, seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for ( let i = 0; i < 400; i++ ) {
    const placed = Array.from({ length: 1 + Math.floor(rnd() * 9) }, (_, j) => ({ key: j, role: ["main", "sec", "pre", "wave"][Math.floor(rnd() * 4)], loud: rnd(), t: Math.floor(rnd() * 900) }));
    for ( const big of [false, true] ) for ( const caps of Object.values(C.CAPS) ) { cases++; const alive = Math.floor(rnd() * 12);
      if ( JSON.stringify(PF.shareOf(placed, { big, caps, alive, capWords: C.capWords }).map((w) => w.key)) === JSON.stringify(old(placed, big, caps, alive).map((w) => w.key)) ) same++; }
  }
  ok(same === cases, `shareOf is the old seat share (${same} of ${cases})`);
  ok(PF.mayWrite("sfxLayer", false) === false && PF.mayWrite("sfxLayer", true) && PF.mayWrite("perfMode", false), "mayWrite: a table key only by a GM; other keys untouched");
});

if ( failed.length ) { console.error(failed.join("\n")); console.error(`sfx-prefs: ${failed.length} group(s) failed, ${n} checks passed`); process.exit(1); }
console.log(`sfx-prefs: ${n} checks passed`);
process.exit(0);
