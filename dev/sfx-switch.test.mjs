// MAPSWITCH (owner, 2026-11-16: «przełącznik napisów on off w zniszczeniach, pogodzie i żetonach (zakładki moinen maps) i suwaki
// wielkości»): per area a lettering switch and a size slider in that area's own tab, the GM's for the table.
// The real sfx.mjs runs on fake seats that share one fake world store (the harness of dev/sfx-prefs.test.mjs: Foundry's rules for world
// settings - pre-hook cancel, the server's refusal of a player's restricted write, create / update / delete hooks and onChange on every seat).
//   PURE     sfx-size: stepWith, shownPair, pairWrites; sfx-prefs: the switches are table keys, tableOf's steps are what is lettered
//   LIVE     a GM's switch-off reaches the player's seat at once (the group letters at step 0 there), switch-on brings the size back that
//            it had, a size change reaches it; the other groups never move; a reset (delete) brings the default; a player cannot write
//   TOKENS   the tokens group: a plough's story is lettered by it (not by destruction), the entry hook stays for it
//   REACT    the token reactions' words of another module (its two world settings) follow the tokens group and the group follows them:
//            both ways, only by the GM seat that wrote, settled after one pass, a quick double change kept, nothing without that module
//   TABS     the dock panel is added to the three tabs (Destruction with fire, Weather, Tokens), writes at once, follows the world;
//            the table window shows the same pair; texts in both languages
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; if ( process.env.SWITCH_VERBOSE ) console.log("  ok", m); };
const failed = [];
const group = async (id, fn) => { try { await fn(); } catch ( err ) { failed.push(`${id}: ${String(err?.message ?? err).split(/\r?\n/)[0]}`); } };
const MOD = "moinen-maps", PU = "invincible-plus-ultra";
const src = (f) => fs.readFileSync(path.join(root, "scripts", f), "utf8");

/* ---------------------------------------------------------------- minimal Foundry around the seats (as dev/sfx-prefs.test.mjs) */
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

const world = new Map();          // key -> Setting document { key, value }
const seats = [];
const notes = [];
let writes = [];                  // every world write that went through: [seat, key, value]
function makeSeat(name, isGM, { react = false, active = isGM } = {}) {
  const hooks = new Map(), reg = new Map(), store = new Map();
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
    i18n: { lang: "en", localize: (k) => k, format: (k) => k, has: () => true },
    modules: new Map([[MOD, { id: MOD, active: true, api: {} }], ...(react ? [[PU, { id: PU, active: true }]] : [])]), keybindings: { register() {} },
    settings: {
      settings: reg,
      register(m, k, cfg) { reg.set(`${m}.${k}`, { ...cfg, key: k, namespace: m }); },
      registerMenu(m, k, cfg) { S.menus.set(`${m}.${k}`, cfg); },
      get(m, k) { return getOf(`${m}.${k}`); },
      async set(m, k, v) { return writeSetting(S, `${m}.${k}`, v); },
      storage: new Map([["world", { getSetting: (id) => world.get(id) ?? null }]])
    }
  };
  // (the other module's two table values, registered as it registers them: world, not restricted, the switch with an onChange)
  if ( react ) {
    S.game.settings.register(PU, "tokenReactEnabled", { scope: "world", config: false, type: Boolean, default: true, onChange: () => {} });
    S.game.settings.register(PU, "tokenReactSize", { scope: "world", config: false, type: String, default: "normal" });
  }
  S.ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  S.ui = { notifications: { warn: (m) => notes.push([name, "warn", m]), info: (m) => notes.push([name, "info", m]), error: (m) => notes.push([name, "error", m]) } };
  seats.push(S);
  return S;
}
let cur = null;
function enter(S) { cur = S; globalThis.game = S.game; globalThis.Hooks = S.Hooks; globalThis.localStorage = S.ls; globalThis.ui = S.ui; }
function on(S, fn) { const prev = cur; enter(S); try { return fn(); } finally { if ( prev ) enter(prev); } }
const tick = () => new Promise((r) => setImmediate(r));
async function writeSetting(S, id, value) {
  const c = S.reg.get(id); if ( !c ) throw new Error(`not registered ${id}`);
  const had = world.get(id), doc = { key: id, value: structuredClone(value), _stats: { modifiedTime: Date.now() } };
  const pre = on(S, () => S.Hooks.call(had ? "preUpdateSetting" : "preCreateSetting", had ?? doc, { key: id, value }, {}, S.game.user.id));
  if ( pre === false ) { if ( !had ) throw new TypeError("Cannot read properties of undefined (reading 'value')"); return had.value; }
  if ( c.restricted && !S.isGM ) { on(S, () => S.ui.notifications.error("server: permission denied")); throw new Error("refused by the server"); }
  await tick();                                                        // (the server's round trip: other writes of the seat may land meanwhile)
  world.set(id, doc); writes.push([S.name, id, value]);
  for ( const T of seats ) on(T, () => { if ( had ) T.Hooks.callAll("updateSetting", doc, { value }, {}, S.game.user.id); else T.Hooks.callAll("createSetting", doc, {}, S.game.user.id);   // (Foundry's signatures: create (doc, options, userId), update (doc, change, options, userId))
     T.reg.get(id)?.onChange?.(doc.value); });
  return doc.value;
}
function deleteSetting(S, id) { const d = world.get(id); if ( !d ) return; world.delete(id); for ( const T of seats ) on(T, () => T.Hooks.callAll("deleteSetting", d, {}, S.game.user.id)); }
/** let every follow-up write settle (the bridge writes after the hooks) */
const settle = async () => { for ( let i = 0; i < 30; i++ ) await tick(); };

const PF = await import(pathToFileURL(path.join(root, "scripts/sfx/sfx-prefs.mjs")).href);
const SZ = await import(pathToFileURL(path.join(root, "scripts/sfx/sfx-size.mjs")).href);
const RX = await import(pathToFileURL(path.join(root, "scripts/sfx/sfx-react.mjs")).href);
let seatNo = 0;
async function boot(S) {
  enter(S);
  const m = await import(pathToFileURL(path.join(root, "scripts/sfx/sfx.mjs")).href + `?switch=${++seatNo}`);
  S.sfx = m;
  m.registerSfx();
  S.Hooks.callAll("init");
  for ( const fn of S.hooks.get("ready") ?? [] ) await fn();
  await settle();
  return S;
}
const sizes = (S) => on(S, () => S.sfx.sfxApi.status().sizes);
const shown = (S, g) => on(S, () => S.sfx.sfxApi.group(g));
// (the seat that acts stays entered: its async writes go on after an await under ITS globals - one browser per seat in Foundry)
const set = (S, g, want) => { enter(S); return S.sfx.sfxApi.set(g, want); };
const reset = () => { world.clear(); seats.length = 0; notes.length = 0; writes = []; cur = null; };
const J = (o) => JSON.stringify(o);

/* ---------------------------------------------------------------- PURE */
await group("PURE", async () => {
  ok(SZ.stepWith(true, 3) === 3 && SZ.stepWith(undefined, 1) === 1 && SZ.stepWith(false, 3) === 0 && SZ.stepWith(true, 0) === 0 && SZ.stepWith(true, null) === 2, "stepWith: off letters at step 0 whatever the size; on at the stored size; a world without the switch is on");
  ok(J(SZ.shownPair(true, 3)) === J({ on: true, size: 3 }) && J(SZ.shownPair(false, 3)) === J({ on: false, size: 3 }) && J(SZ.shownPair(true, 0)) === J({ on: false, size: 2 }) && J(SZ.shownPair(undefined, undefined)) === J({ on: true, size: 2 }),
    "shownPair: the switch and a slider 1..3 (off keeps its size; the older stored 0 shows off at today's size)");
  ok(J(SZ.pairWrites({ on: true, size: 2 }, { on: false })) === J({ on: false }), "switching off writes the switch only: the size is kept");
  ok(J(SZ.pairWrites({ on: false, size: 3 }, { on: true })) === J({ on: true }), "switching on writes the switch only: the size it had comes back");
  ok(J(SZ.pairWrites({ on: true, size: 2 }, { size: 3 })) === J({ size: 3 }) && J(SZ.pairWrites({ on: true, size: 2 }, { size: 2 })) === "{}" && J(SZ.pairWrites({ on: true, size: 2 }, { on: true })) === "{}", "a size change writes the size only; nothing that already stands is written again");
  ok(J(SZ.pairWrites({ on: true, size: 0 }, { on: true })) === J({ size: 2 }) && J(SZ.pairWrites({ on: true, size: 0 }, { on: false })) === J({ on: false, size: 2 }), "a stored size 0 (the older \"none\"): switched on it gets today's size; the switch alone says off from then on");
  ok(J(SZ.pairWrites({ on: true, size: 2 }, { size: 9 })) === J({ size: 3 }) && J(SZ.pairWrites({ on: true, size: 2 }, { size: 0 })) === J({ size: 1 }), "the slider is 1..3: 0 is the switch's to say");
  for ( const g of SZ.SIZE_GROUPS ) {
    ok(PF.TABLE_KEYS.includes(SZ.ON_SETTING[g]) && PF.TABLE[SZ.ON_SETTING[g]].def === true && PF.clean(SZ.ON_SETTING[g], "x") === true && PF.clean(SZ.ON_SETTING[g], false) === false, `${g}: its switch is a table key, on by default`);
    ok(PF.mayWrite(SZ.ON_SETTING[g], false) === false && PF.mayWrite(SZ.ON_SETTING[g], true) === true, `${g}: only a GM writes its switch`);
    ok(["destruction", "weather", "tokens"].includes(SZ.GROUP_TAB[g]), `${g}: it stands in a tab (${SZ.GROUP_TAB[g]})`);
  }
  ok(["destruction", "weather", "tokens"].every((t) => SZ.SIZE_GROUPS.some((g) => SZ.GROUP_TAB[g] === t)) && SZ.GROUP_TAB.fire === "destruction", "each of the three tabs has a group; fire stands in the Destruction tab");
  const val = { sfxOnFire: false, sfxSizeFire: 3, sfxSizeWeather: 0, sfxSizeTokens: 1 };
  const t = PF.tableOf((k) => (k in val ? val[k] : PF.TABLE[k].def));
  ok(J(t.steps) === J({ destruction: 2, fire: 0, weather: 0, tokens: 1 }) && J(t.on) === J({ destruction: true, fire: false, weather: false, tokens: true }), "tableOf: the steps every seat letters at (0 for a group switched off) and the switches as shown");
  const sh = PF.shownOf((k) => (k in val ? val[k] : PF.TABLE[k].def));
  ok(sh.sfxOnFire === false && sh.sfxSizeFire === 3 && sh.sfxOnWeather === false && sh.sfxSizeWeather === 2 && sh.sfxOnTokens === true && sh.sfxSizeTokens === 1, "the table window shows the same pair as the tabs");
});

/* ---------------------------------------------------------------- LIVE: GM writes, every seat follows */
await group("LIVE", async () => {
  reset();
  const gm = await boot(makeSeat("gm", true)), pl = await boot(makeSeat("player", false));
  ok(J(sizes(pl)) === J({ destruction: 2, fire: 2, weather: 2, tokens: 2 }), "a fresh world: every group on at today's size");
  for ( const g of SZ.SIZE_GROUPS ) {
    const others = () => J(SZ.SIZE_GROUPS.filter((q) => q !== g).map((q) => [sizes(gm)[q], sizes(pl)[q]]));
    const before = others();
    await set(gm, g, { size: 3 }); await settle();
    ok(sizes(gm)[g] === 3 && sizes(pl)[g] === 3, `${g}: the GM's size 3 is lettered on both seats`);
    await set(gm, g, { on: false }); await settle();
    ok(sizes(gm)[g] === 0 && sizes(pl)[g] === 0 && shown(pl, g).on === false, `${g}: switched off, both seats letter nothing of it`);
    ok(world.get(`${MOD}.${SZ.SIZE_SETTING[g]}`)?.value === 3, `${g}: its size is kept while it is off`);
    await set(gm, g, { on: true }); await settle();
    ok(sizes(gm)[g] === 3 && sizes(pl)[g] === 3, `${g}: switched on again at the size it had`);
    await set(gm, g, { size: 1 }); await settle();
    ok(sizes(gm)[g] === 1 && sizes(pl)[g] === 1, `${g}: the GM's size 1 on both seats`);
    ok(others() === before, `${g}: no other group moved`);
    // a player cannot write (the tab is the GM's; the macro path too)
    const w0 = writes.length;
    const r = await set(pl, g, { on: false }); await settle();
    ok(r === false && writes.length === w0 && sizes(pl)[g] === 1, `${g}: a player's seat writes nothing`);
    let refused = false; try { await on(pl, () => pl.game.settings.set(MOD, SZ.ON_SETTING[g], false)); } catch { refused = true; }
    ok((refused || world.get(`${MOD}.${SZ.ON_SETTING[g]}`)?.value !== false) && sizes(pl)[g] === 1, `${g}: a player's own write of the switch is cancelled`);
    // a reset: the documents deleted (no onChange): every seat back at the default
    await set(gm, g, { on: false }); await settle();
    deleteSetting(gm, `${MOD}.${SZ.ON_SETTING[g]}`); deleteSetting(gm, `${MOD}.${SZ.SIZE_SETTING[g]}`); await settle();
    ok(sizes(gm)[g] === 2 && sizes(pl)[g] === 2, `${g}: a reset brings it back on at today's size on both seats`);
  }
  // the older "none" (size 0, written by an older window or a macro) reads as switched off, and the switch brings today's size
  await on(gm, () => gm.game.settings.set(MOD, "sfxSizeWeather", 0)); await settle();
  ok(sizes(pl).weather === 0 && J(shown(pl, "weather")) === J({ on: false, size: 2 }), "a stored size 0 shows as switched off");
  await set(gm, "weather", { on: true }); await settle();
  ok(sizes(pl).weather === 2 && world.get(`${MOD}.sfxSizeWeather`)?.value === 2, "switched on from a stored 0: today's size");
});

/* ---------------------------------------------------------------- TOKENS: the plough is the tokens group's */
await group("TOKENS", async () => {
  const sfx = src("sfx/sfx.mjs");
  ok(/storyPage\(`plough\|\$\{g\.objId\}\|\$\{Math\.round\(sh\)\}`, sh, words, C\.matOf\(g\.info\.mat\), "tokens"\);/.test(sfx), "a plough's story is told with the tokens group (its switch and size)");
  ok(/if \( mode\(\) === "off" \|\| stepFor\("tokens"\) === 0 \) return true;/.test(sfx), "tokens off: a plough is handled (its stroke letters no destruction word in its place) and letters nothing");
  ok(/const grp = SZ\.groupOfPageWord\(w, p\.grp\);\n\s*if \( stepFor\(grp\) === 0 \) return;/.test(sfx), "a story word waiting for its moment is dropped when its group was switched off meanwhile");
  ok(/for \( const a of alive \) if \( a\.sg === g \) \{ try \{ a\.h\.stop\(\); \} catch \{\} \}/.test(sfx) && /sg: grpOf\(w\)/.test(sfx), "a group switched off: its words standing now leave");
  ok(SZ.groupOfPageWord({ role: "main" }, "tokens") === "tokens" && SZ.groupOfPageWord({ role: "main" }) === "destruction", "a story's own group wins over the page role");
});

/* ---------------------------------------------------------------- REACT: the token reactions' words of the other module */
await group("REACT", async () => {
  ok(J(RX.toReact({ on: true, size: 2 }, { on: true, size: "normal" })) === "{}" && J(RX.fromReact({ on: true, size: "normal" }, { on: true, size: 2 })) === "{}", "equal pairs: nothing to write either way");
  ok(J(RX.toReact({ on: false, size: 3 }, { on: true, size: "normal" })) === J({ on: false, size: "large" }) && J(RX.toReact({ on: true, size: 1 }, { on: true, size: "normal" })) === J({ size: "small" }), "the map's pair -> the reactions' values (1 small, 2 normal, 3 large)");
  ok(J(RX.fromReact({ on: false, size: "large" }, { on: true, size: 2 })) === J({ on: false, size: 3 }) && J(RX.fromReact({ on: true, size: "small" }, { on: true, size: 2 })) === J({ size: 1 }) && J(RX.fromReact({ on: true, size: "odd" }, { on: true, size: 2 })) === "{}", "the reactions' values -> the map's pair (an unknown size name: today's)");
  ok(J(RX.fromReact({ on: false, size: "normal" }, { on: true, size: 0 })) === "{}", "a map pair that already shows the same is left alone");
  const react = () => ({ on: world.get(`${PU}.tokenReactEnabled`)?.value ?? true, size: world.get(`${PU}.tokenReactSize`)?.value ?? "normal" });

  // without the other module: nothing of it is read or written
  reset();
  { const gm = await boot(makeSeat("gm", true));
    ok(on(gm, () => gm.sfx.sfxApi.linked()) === false, "without the other module the tokens group is not linked");
    await set(gm, "tokens", { on: false }); await settle();
    ok(writes.every(([, k]) => k.startsWith(`${MOD}.`)), "... and only the map's own keys are written"); }

  // with it: both ways, by the writing GM seat only
  reset();
  const gm = await boot(makeSeat("gm", true, { react: true })), pl = await boot(makeSeat("player", false, { react: true }));
  ok(on(gm, () => gm.sfx.sfxApi.linked()) === true, "with the other module the tokens group is linked");
  ok(!writes.some(([, k]) => /Tokens$|^invincible-plus-ultra\./.test(k)), "equal at the start: neither pair is written");
  await set(gm, "tokens", { on: false }); await settle();
  ok(react().on === false && sizes(pl).tokens === 0, "tokens switched off in the tab: the reactions' words are off for the table too");
  ok(writes.every(([s]) => s === "gm"), "only the GM's seat wrote");
  await set(gm, "tokens", { on: true }); await set(gm, "tokens", { size: 3 }); await settle();
  ok(react().on === true && react().size === "large" && sizes(pl).tokens === 3, "switched on at size 3: reactions on, large");
  await set(gm, "tokens", { size: 1 }); await settle();
  ok(react().size === "small" && sizes(pl).tokens === 1, "size 1: reactions small");
  // the other module's own window changes its values: the tab follows
  writes = [];
  await on(gm, () => gm.game.settings.set(PU, "tokenReactSize", "normal")); await settle();
  ok(sizes(gm).tokens === 2 && sizes(pl).tokens === 2 && J(shown(pl, "tokens")) === J({ on: true, size: 2 }), "the reactions' size changed in their own window: the tokens group follows on every seat");
  await on(gm, () => gm.game.settings.set(PU, "tokenReactEnabled", false)); await settle();
  ok(sizes(pl).tokens === 0 && shown(gm, "tokens").on === false, "the reactions switched off in their own window: the tokens group is off");
  ok(writes.every(([s]) => s === "gm") && writes.length === 4, `each change is one write and one follow-up, no echo (${writes.length} writes)`);
  // a quick double change (the switch and the slider one after the other, not awaited between): the later one is not taken back
  await on(gm, () => gm.game.settings.set(PU, "tokenReactEnabled", true)); await settle();
  const a = set(gm, "tokens", { size: 3 }), b = set(gm, "tokens", { on: false });
  await a; await b; await settle();
  ok(J(shown(gm, "tokens")) === J({ on: false, size: 3 }) && react().on === false && react().size === "large", "a quick double change settles on what the GM chose, on both pairs");
  writes = []; await settle();
  ok(writes.length === 0, "... and nothing keeps writing");
  // a reset of the map's pair: the reactions follow the default
  deleteSetting(gm, `${MOD}.sfxOnTokens`); deleteSetting(gm, `${MOD}.sfxSizeTokens`); await settle();
  ok(react().on === true && react().size === "normal" && sizes(pl).tokens === 2, "a reset of the tokens group: reactions on, normal");

  // a world where the reactions were already chosen (large, before the tab had a switch): the map's pair takes theirs at the start
  reset();
  world.set(`${PU}.tokenReactSize`, { key: `${PU}.tokenReactSize`, value: "large" });
  const gm2 = await boot(makeSeat("gm", true, { react: true }));
  ok(sizes(gm2).tokens === 3 && react().size === "large" && writes.every(([, k]) => k.startsWith(`${MOD}.`)), "at a start the table's present choice for the reactions is kept and the tokens group takes it");
});

/* ---------------------------------------------------------------- TABS: the dock panels, the window, the texts */
await group("TABS", async () => {
  const tabs = src("sfx/sfx-tabs.mjs"), sections = src("workspace/sections.mjs"), ui = src("sfx/sfx-table-ui.mjs"), sfx = src("sfx/sfx.mjs");
  ok(/import "\.\.\/sfx\/sfx-tabs\.mjs";/.test(sections) && sections.indexOf("sfx-tabs.mjs") > sections.indexOf("./tokens.mjs") && sections.indexOf("sfx-tabs.mjs") > sections.indexOf("../destruction/section.mjs") && sections.indexOf("sfx-tabs.mjs") > sections.indexOf("../weather/section.mjs"),
    "the panels are added after the three sections exist");
  ok(/for \( const tab of \["destruction", "weather", "tokens"\] \)/.test(tabs) && /extendSection\(tab, \{ panels: \[\{ id: "lettering", title: "MOINENMAPS\.Sfx\.tab\.title"/.test(tabs), "one panel in each of the three tabs");
  ok(/if \( what === "on" \) setGroup\(g, \{ on: c\.checked \}\);\n\s*else if \( what === "size" \) setGroup\(g, \{ size: Number\(c\.value\) \}\);/.test(tabs), "a control writes at once, through the one write path (a GM only)");
  ok(/onWorldSetting\(\[\.\.\.SIZE_GROUPS\.flatMap\(\(g\) => \[SIZE_SETTING\[g\], ON_SETTING\[g\]\]\), "sfxLetters"\], \(\) => sync\(host\)\)/.test(tabs), "the panel follows the world (another GM, the table window, a macro, a reset)");
  ok(/min: 1, max: 3, step: 1/.test(tabs) && /r\.disabled = !p\.on/.test(tabs), "the slider is 1..3 and rests while its group is off");
  ok(/scope: "world", config: false,\s*restricted: true, type: Boolean, default: true, onChange: live\(\(\) => sizeChanged\(g\)\) \}\);/.test(sfx) && !/sfxOn\w*", \{[^}]*scope: "client"/.test(sfx), "the switches are world settings of the GM's, live; no client setting");
  ok(/name="\$\{ON_OF\(k\)\}"/.test(ui) && /min="1" max="3"/.test(ui), "the table window's size rows hold the same switch and slider");
  const lang = (l) => JSON.parse(fs.readFileSync(path.join(root, "lang", `${l}.json`), "utf8"));
  const keys = [...SZ.SIZE_GROUPS.flatMap((g) => [`on.${g}`, `on.${g}Hint`, `size.${g}`, `size.${g}Hint`, `table.short.${SZ.SIZE_SETTING[g]}`]), "tab.title", "tab.size", "tab.sizeHint", "tab.linked", "tab.linkedHint", "tab.allOff", "table.on"];
  const en = lang("en"), pl = lang("pl");
  for ( const k of keys ) {
    const a = en[`MOINENMAPS.Sfx.${k}`], b = pl[`MOINENMAPS.Sfx.${k}`];
    ok(typeof a === "string" && a.length > 1 && typeof b === "string" && b.length > 1, `texts in both languages: ${k}`);
    ok(a !== b, `${k}: the Polish text is its own`);
  }
});

if ( failed.length ) { console.error(failed.join("\n")); console.error(`sfx-switch: ${failed.length} group(s) failed, ${n} checks passed`); process.exit(1); }
console.log(`sfx-switch: ${n} checks passed`);
