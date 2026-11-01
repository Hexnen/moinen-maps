import { registerSection } from "./registry.mjs";
import { esc, T, setting, store, onSetting, optHint } from "./ui.mjs";
import { typeLabel } from "../config.mjs";
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
    { id: "filter", title: "MOINENMAPS.WS.pFilter", icon: "fa-solid fa-filter", mount: (host) => dockFilter(host) },
    { id: "presets", title: "MOINENMAPS.WS.pPresets", icon: "fa-solid fa-sliders", open: false, mount: (host) => mountPresetManager(host) }
  ]
});
