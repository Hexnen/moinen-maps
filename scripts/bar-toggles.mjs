import { MODULE_ID } from "./config.mjs";
import { GROUP } from "./workspace/registry.mjs";
import { vramOn, vramOnMode, setVramOn } from "./vram-ui.mjs";
import { barShown, setBarShown } from "./director/bar.mjs";

/**
 * TOGL: three on/off toggles in the map's group of Foundry's left menu (the scene controls, tools.mjs) - the VRAM meter (#mm-vram,
 * vram-ui.mjs), the director's bar (#mm-dir-bar, director/bar.mjs) and the floating pin filter (#mm-filter, filter-panel.mjs). Each
 * toggle IS its panel's own client setting (this user, this browser, kept across reloads) - "vramMeter" (any mode but "off"),
 * "dirBarShown", "pinPanel" - so the settings window, the panel's own switches (the filter's X, the Pins dock's "floating" box) and the
 * toggle never disagree. Each goes to its panel's own audience: the meter's and the filter's to everyone (players see the meter in
 * "auto" while memory runs low, and the filter wherever pins are on), the director bar's to the GM, and only while the director exists
 * (CONFIG.moinenMaps.noDirector unset). A panel switched off is taken out of the page, so what keeps clear of it (the turn camera, the
 * folded Orbit button, the party column, the combat dock) stops giving it room.
 */

const VRAM = "mmVramBar", DIR = "mmDirBar", PINS = "mmPinBar";
/** The meter's tooltip says when it shows: in "warn", and a player's "auto", only while memory runs low. */
function vramTitle() {
  const m = vramOnMode();
  return m === "warn" || (m === "auto" && !game.user.isGM) ? "MOINENMAPS.Tool.vramBarLow" : "MOINENMAPS.Tool.vramBar";
}
const pinsOn = () => { try { return !!game.settings.get(MODULE_ID, "pinPanel"); } catch { return false; } };
function setPinsOn(on) { if ( !!on === pinsOn() ) return null; try { return game.settings.set(MODULE_ID, "pinPanel", !!on); } catch { return null; } }

function addToggles(controls) {
  const g = controls[GROUP]; if ( !g ) return;
  g.tools ??= {};
  g.tools[PINS] = { name: PINS, order: 899, toggle: true, active: pinsOn(), icon: "fa-solid fa-map-pin", title: "MOINENMAPS.Tool.pinBar",
    onChange: (_ev, on) => { setPinsOn(on); } };
  g.tools[VRAM] = { name: VRAM, order: 900, toggle: true, active: vramOn(), icon: "fa-solid fa-memory", title: vramTitle(),
    onChange: (_ev, on) => { setVramOn(on); } };
  if ( game.user.isGM && !globalThis.CONFIG?.moinenMaps?.noDirector ) {
    g.tools[DIR] = { name: DIR, order: 901, toggle: true, active: barShown(), icon: "fa-solid fa-clapperboard",
      title: "MOINENMAPS.Tool.dirBar", onChange: (_ev, on) => { setBarShown(on); } };
  }
}

/** A setting changed elsewhere (the settings window, the panel's own switch, a macro): the toggle follows without a click. */
function follow(name, on) {
  const t = ui.controls?.controls?.[GROUP]?.tools?.[name];
  if ( !t || t.active === on ) return;
  if ( ui.controls.control?.name === GROUP && ui.controls.rendered ) ui.controls.activate({ toggles: { [name]: on } });
  else t.active = on;
}

// (after init: tools.mjs builds the group in a handler main.mjs adds while the modules load; these tools go into it afterwards)
Hooks.once("init", () => Hooks.on("getSceneControlButtons", addToggles));
Hooks.on("moinenMapsVram", () => {
  const t = ui.controls?.controls?.[GROUP]?.tools?.[VRAM];
  if ( t ) t.title = vramTitle();
  follow(VRAM, vramOn());
});
Hooks.on("moinenMapsBarToggle", (which, on) => { if ( which === "dirBar" ) follow(DIR, on); });
Hooks.on("moinenMapsPanel", () => follow(PINS, pinsOn()));
