import { registerSection } from "./registry.mjs";
import { esc, T, setting, store, onSetting, optHint, optFold } from "./ui.mjs";
import { typeLabel, IDLE_MODES } from "../config.mjs";
import { fontFamilies } from "../labels.mjs";
import { sceneForm, sf } from "./scene-form.mjs";
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

// which folds of the Pin look panel are open (kept while it is drawn again)
const lookFolds = new Set();

/**
 * How the pins of the viewed scene look and move (the scene's own config, GM only): on/off and colour first, then size and glyph;
 * motion and the hover text folded. The size slider of the chosen mode only; everything but the switch hides while pins are off.
 */
function lookPanel(host) {
  return sceneForm(host, {
    folds: lookFolds,
    deps: [
      ['[data-dep="pins"]', (v) => v("enabled")],
      ['[data-dep="size"]', (v) => v("sizeBy") !== "grid"],
      ['[data-dep="sizeGrid"]', (v) => v("sizeBy") === "grid"],
      ['[data-dep="drop"]', (v) => v("drop")],
      ['[data-dep="idle"]', (v) => v("idle") !== "none"]
    ],
    html: (c) => `${sf.check(c, "enabled", "Enabled", "EnabledHint")}
      <div data-dep="pins">
      ${sf.color(c, "color", "Color", "#e5322d")}
      ${sf.check(c, "useNoteTint", "UseNoteTint", "UseNoteTintHint")}
      ${sf.select(c, "sizeBy", "SizeBy", [["note", T("SizeByNote")], ["grid", T("SizeByGrid")]], "SizeByHint")}
      <div data-dep="size">${sf.range(c, "size", "Size", 0.5, 2, 0.05)}</div>
      <div data-dep="sizeGrid">${sf.range(c, "sizeGrid", "SizeGrid", 0.2, 3, 0.05, "SizeGridHint")}</div>
      ${sf.select(c, "glyph", "GlyphInside", [["note", T("GlyphNote")], ["dot", T("GlyphDot")]], "GlyphHint")}
      ${sf.check(c, "shadow", "Shadow")}
      ${sf.check(c, "glow", "Glow", "GlowHint")}
      ${optFold({ id: "motion", title: T("Scene.Motion"), icon: "fa-solid fa-wand-magic-sparkles", open: lookFolds, body: `
        ${sf.check(c, "drop", "Drop", "DropHint")}
        <div data-dep="drop">${sf.range(c, "dropHeight", "DropHeight", 0.3, 2, 0.05)}${sf.range(c, "bounce", "Bounce", 0, 1, 0.05)}${sf.range(c, "squeeze", "Squeeze", 0, 1, 0.05)}</div>
        ${sf.check(c, "hop", "Hop", "HopHint")}
        ${sf.select(c, "idle", "IdleMode", IDLE_MODES.map((m) => [m, T(`Idle.${m}`)]))}
        <div data-dep="idle">${sf.range(c, "idleStrength", "IdleStrength", 0, 1, 0.05)}${sf.range(c, "idleSpeed", "IdleSpeed", 0.2, 3, 0.05)}</div>` })}
      ${optFold({ id: "pintext", title: T("Label.pinSection"), icon: "fa-solid fa-tag", open: lookFolds, attrs: `data-tooltip="${esc(T("Label.pinHint"))}"`, body: `
        ${sf.select(c, "pinText.family", "Label.family", [["", T("Label.default")], ...fontFamilies().map((f) => [f, f])])}
        ${sf.range(c, "pinText.size", "Label.size", 0, 96, 1, "Label.pinSizeHint")}
        ${sf.color(c, "pinText.color", "Label.textColor", "#ffffff")}
        ${sf.color(c, "pinText.halo", "Label.halo", "#000000")}
        ${sf.range(c, "pinText.haloWidth", "Label.haloWidth", 0, 16, 0.5)}` })}
      </div>`
  });
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
