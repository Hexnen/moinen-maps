// node dev/bar-toggles.test.mjs: TOGL - the VRAM meter's and the director bar's toggles in the map's group of the left menu
// (scripts/bar-toggles.mjs). With small Foundry stubs (settings in memory, hooks recorded):
//   1. the toggles are the bars' own client settings ("vramMeter", "dirBarShown"): defaults on, so nothing changes untouched;
//   2. the VRAM toggle keeps the mode it had ("warn" survives off/on), "auto" when there was none;
//   3. who gets which toggle: the GM both, a player the meter's only, the director's not when the director is killed;
//   4. a setting changed elsewhere (the settings window) moves the toggle; the meter's tooltip says when a player's meter shows;
//   5. the pin filter's toggle is "pinPanel" (default unchanged), for everyone; the filter's own X moves it.
const hooks = {};
const on = (n, f) => { (hooks[n] ??= []).push(f); return hooks[n].length; };
globalThis.Hooks = { on, once: on, off() {}, callAll: (n, ...a) => { for ( const f of hooks[n] ?? [] ) f(...a); } };
globalThis.window ??= { addEventListener() {}, removeEventListener() {} };
globalThis.foundry ??= { utils: { escapeHTML: (s) => s } };
globalThis.CONFIG ??= { moinenMaps: {} };
const store = new Map(), defs = new Map();
globalThis.game = {
  user: { isGM: true },
  i18n: { lang: "en", localize: (k) => k, format: (k) => k },
  settings: {
    register: (m, k, d) => defs.set(k, d),
    get: (m, k) => { if ( !defs.has(k) ) throw new Error(`not registered ${k}`); return store.has(k) ? store.get(k) : structuredClone(defs.get(k).default); },
    set: async (m, k, v) => { store.set(k, v); defs.get(k)?.onChange?.(v); return v; }
  },
  combats: null, modules: { get: () => null }
};
globalThis.canvas = { ready: false };
let activated = null;
globalThis.ui = { controls: { controls: {}, control: null, rendered: true, activate: (o) => { activated = o; } } };

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if ( !c ) fails++; };

const VU = await import("../scripts/vram-ui.mjs");
const B = await import("../scripts/director/bar.mjs");
await import("../scripts/bar-toggles.mjs");
const { GROUP } = await import("../scripts/workspace/registry.mjs");
B.registerBar();                                                // (director/index.mjs calls it in the module)
try { (await import("../scripts/filter.mjs")).registerFilterSettings(); } catch (e) { console.log("filter settings:", e.message); }
for ( const f of hooks.init ?? [] ) { try { f(); } catch { /* other modules' init needs more of Foundry */ } }

const build = () => {
  const controls = { [GROUP]: { name: GROUP, tools: {} } };
  for ( const f of hooks.getSceneControlButtons ?? [] ) { try { f(controls); } catch { /* tools.mjs needs the scene */ } }
  return controls[GROUP].tools;
};

// 1. defaults
ok(defs.get("vramMeter")?.scope === "client" && defs.get("dirBarShown")?.scope === "client" && defs.get("dirBarShown").default === true,
  "both toggles are client settings (this user, this browser); the director bar defaults to shown");
let t = build();
ok(t.mmVramBar?.toggle && t.mmVramBar.active === true && t.mmDirBar?.toggle && t.mmDirBar.active === true, "GM, untouched: both toggles on (nothing changes)");
ok(t.mmVramBar.icon === "fa-solid fa-memory" && t.mmDirBar.icon === "fa-solid fa-clapperboard", "icons: the meter's memory chip, the bar's clapperboard");

// 2. the meter's mode survives the toggle
await game.settings.set("moinen-maps", "vramMeter", "warn");
await VU.setVramOn(false);
ok(game.settings.get("moinen-maps", "vramMeter") === "off" && VU.vramOn() === false, "off: vramMeter = off");
await VU.setVramOn(true);
ok(game.settings.get("moinen-maps", "vramMeter") === "warn", "on again: back to the mode it had (warn)");
store.delete("vramMeterState"); await game.settings.set("moinen-maps", "vramMeter", "off");
await VU.setVramOn(true);
ok(game.settings.get("moinen-maps", "vramMeter") === "auto", "on with nothing remembered: auto (the default)");

// 3. the director bar's toggle and who gets what
t = build();
t.mmDirBar.onChange(null, false);
ok(game.settings.get("moinen-maps", "dirBarShown") === false && B.barShown() === false, "the director toggle off: dirBarShown = false");
t.mmDirBar.onChange(null, true);
ok(B.barShown() === true, "and on again");
game.user.isGM = false;
t = build();
ok(t.mmVramBar && !t.mmDirBar, "a player: the meter's toggle, not the director's (the director bar is the GM's)");
ok(t.mmVramBar.title === "MOINENMAPS.Tool.vramBarLow", "a player's meter in auto: the tooltip says it shows when memory runs low");
game.user.isGM = true; CONFIG.moinenMaps.noDirector = true;
ok(!build().mmDirBar, "director killed (CONFIG.moinenMaps.noDirector): no director toggle");
CONFIG.moinenMaps.noDirector = false;

// 4. a change made elsewhere moves the toggle
t = build();
ui.controls.controls = { [GROUP]: { name: GROUP, tools: t } }; ui.controls.control = ui.controls.controls[GROUP];
activated = null;
await game.settings.set("moinen-maps", "vramMeter", "off");
ok(activated?.toggles?.mmVramBar === false, "the settings window sets the meter off: the toggle follows (activate toggles)");
ui.controls.control = null;
await game.settings.set("moinen-maps", "dirBarShown", false);
ok(t.mmDirBar.active === false, "the bar hidden while another group is open: the stored toggle follows");

// 5. the pin filter's toggle is the setting "pinPanel" (default unchanged: shown), for everyone; the filter's X moves it
ok(defs.get("pinPanel")?.scope === "client" && defs.get("pinPanel").default === true, "pinPanel: client setting, default shown (unchanged)");
t = build();
ok(t.mmPinBar?.toggle && t.mmPinBar.active === true && t.mmPinBar.icon === "fa-solid fa-map-pin", "GM: the pin filter's toggle, on");
t.mmPinBar.onChange(null, false);
ok(game.settings.get("moinen-maps", "pinPanel") === false, "the pin toggle off: pinPanel = false");
t.mmPinBar.onChange(null, true);
ok(game.settings.get("moinen-maps", "pinPanel") === true, "and on again");
ui.controls.controls = { [GROUP]: { name: GROUP, tools: t } }; ui.controls.control = ui.controls.controls[GROUP]; activated = null;
await game.settings.set("moinen-maps", "pinPanel", false);            // what the filter's X does
ok(activated?.toggles?.mmPinBar === false, "the filter closed with its X: the toggle follows");
game.user.isGM = false;
ok(!!build().mmPinBar, "a player gets the pin filter's toggle too");
game.user.isGM = true;

console.log(fails ? `${fails} failed` : "bar-toggles: all ok");
process.exit(fails ? 1 : 0);
