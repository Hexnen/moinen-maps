import { registerSection } from "./registry.mjs";
import { esc, T, setting, store, onSetting, optHint, optRange, optSelect, isEcho } from "./ui.mjs";
import { typeLabel, sceneConfig, MODULE_ID } from "../config.mjs";
import { currentPinType, thumb, mountPalette, mountPresetManager, managerSelect } from "../presets.mjs";
import { dockFilter } from "../filter-panel.mjs";
import { swatchesHtml, wireSwatches, clearPins } from "../tools.mjs";

/**
 * Pins: select and place pins, and clear them (tools of the bar), the pin and colour the placing tool drops (its options), and the
 * palette, the filter and the preset manager (dock). The colour used to be a dialog and the palette a popover; both now stay on screen.
 */

const PIN_TOOL = "mm-pin";

/** Options bar: the pin that will be dropped, its colour, and the tool's modifiers. */
function pinsBar(host, ctx) {
  const draw = () => {
    if ( ctx.tool !== PIN_TOOL ) { host.innerHTML = optHint(T("WS.selectHint")); return; }
    const t = currentPinType(), picked = setting("pinColor") || "";
    host.innerHTML = `<button type="button" class="mm-ws-pinpick" data-act="palette" aria-label="${esc(game.i18n.format("MOINENMAPS.WS.pinType", { type: typeLabel(t) }))}" data-tooltip="${esc(game.i18n.format("MOINENMAPS.WS.pinType", { type: typeLabel(t) }))}">
        <img src="${thumb(t.glyph, picked || t.color)}" alt="" inert><span>${esc(typeLabel(t))}</span></button>
      <div class="mm-ws-opt mm-ws-colors" role="group" aria-label="${esc(T("Tool.color"))}">
        <span class="mm-ws-label" aria-hidden="true">${esc(T("WS.color"))}</span>${swatchesHtml(picked)}
        <color-picker name="custom" value="${esc(picked || t.color)}" aria-label="${esc(T("ColorCustom"))}" data-tooltip="${esc(T("ColorCustom"))}"></color-picker>
        <input type="hidden" name="pick" value="${esc(picked)}">
      </div>
      ${optHint(T("WS.pinHint"))}`;
    const pick = host.querySelector('[name="pick"]');
    wireSwatches(host, pick);
    pick.addEventListener("change", () => store("pinColor", pick.value || ""));
  };
  const onChange = (ev) => { if ( ev.target.name === "custom" ) store("pinColor", ev.target.value); };
  const onClick = (ev) => { if ( ev.target.closest('[data-act="palette"]') ) ctx.revealPanel("palette"); };
  host.addEventListener("change", onChange);
  host.addEventListener("click", onClick);
  // the colour, the pin or the presets changed (here, in the palette, by another GM): redraw the bar
  const off = onSetting(["pinColor", "pinType", "pinPreset"], () => draw());
  const offWorld = Hooks.on("updateSetting", (s) => { if ( s.key === "moinen-maps.pinPresets" ) draw(); });
  draw();
  return () => { off(); Hooks.off("updateSetting", offWorld); host.removeEventListener("change", onChange); host.removeEventListener("click", onClick); };
}

/**
 * The size of the pins on the viewed scene (the same keys as the Scene Config tab: sizeBy, size, sizeGrid): from the note's icon size
 * times a multiplier, or a share of a grid square. Only the slider of the chosen mode shows. GM only; follows the scene and scene switches.
 */
function lookPanel(host) {
  const render = () => {
    const s = canvas?.scene;
    if ( !s ) { host.innerHTML = `<p class="hint">${esc(T("Zones.noScene"))}</p>`; return; }
    const c = sceneConfig(s), grid = c.sizeBy === "grid";
    host.innerHTML = `<div class="mm-ws-form">
      ${optSelect({ name: "sizeBy", label: T("SizeBy"), value: c.sizeBy, hint: T("SizeByHint"), options: [["note", T("SizeByNote")], ["grid", T("SizeByGrid")]] })}
      ${grid ? optRange({ name: "sizeGrid", label: T("SizeGrid"), value: c.sizeGrid, min: 0.2, max: 3, step: 0.05, hint: T("SizeGridHint") })
        : optRange({ name: "size", label: T("Size"), value: c.size, min: 0.5, max: 2, step: 0.05 })}</div>`;
    if ( !game.user.isGM ) host.querySelectorAll("select, range-picker").forEach((c2) => { c2.disabled = true; });
  };
  const onChange = (ev) => {
    if ( isEcho() || !game.user.isGM ) return;
    const c = ev.target.closest?.("[name]"), s = canvas?.scene; if ( !c || !s ) return;
    if ( !["sizeBy", "size", "sizeGrid"].includes(c.name) ) return;
    const v = c.name === "sizeBy" ? c.value : Number(c.value);
    if ( c.name !== "sizeBy" && !Number.isFinite(v) ) return;
    if ( sceneConfig(s)[c.name] === v ) return;
    s.update({ [`flags.${MODULE_ID}.config.${c.name}`]: v });
  };
  host.addEventListener("change", onChange);
  const onScene = (s, ch) => { if ( s.id === canvas?.scene?.id && foundry.utils.hasProperty(ch, `flags.${MODULE_ID}.config`) && !host.contains(document.activeElement) ) render(); };
  const hU = Hooks.on("updateScene", onScene), hC = Hooks.on("canvasReady", () => render());
  render();
  return () => { host.removeEventListener("change", onChange); Hooks.off("updateScene", hU); Hooks.off("canvasReady", hC); };
}

registerSection({
  id: "pins", order: 1, title: "MOINENMAPS.WS.pins", icon: "fa-solid fa-location-dot", color: "#e5322d",
  activeTool: "select",
  tools: () => [
    { name: "select", order: 1, title: "MOINENMAPS.Tool.select", icon: "fa-solid fa-arrow-pointer", control: true },
    // the placing tool drops the pin picked in the palette and wears its glyph and colour
    { name: PIN_TOOL, order: 2, title: "MOINENMAPS.Tool.pin", icon: `fa-solid ${currentPinType().fa}`, color: setting("pinColor") || currentPinType().color, control: true },
    { name: "clear", order: 9, title: "MOINENMAPS.Tool.clear", icon: "fa-solid fa-trash", button: true, onClick: () => clearPins() }
  ],
  bar: pinsBar,
  panels: [
    { id: "palette", title: "MOINENMAPS.WS.pPalette", icon: "fa-solid fa-layer-group",
      mount: (host, ctx) => mountPalette(host, { onManage: async (id) => { await ctx.revealPanel("presets"); managerSelect(id); } }) },
    { id: "look", title: "MOINENMAPS.WS.pLook", icon: "fa-solid fa-up-right-and-down-left-from-center", mount: (host) => lookPanel(host) },
    { id: "filter", title: "MOINENMAPS.WS.pFilter", icon: "fa-solid fa-filter", mount: (host) => dockFilter(host) },
    { id: "presets", title: "MOINENMAPS.WS.pPresets", icon: "fa-solid fa-sliders", open: false, mount: (host) => mountPresetManager(host) }
  ]
});
