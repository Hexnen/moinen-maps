import { registerSection } from "./registry.mjs";
import { esc, T, setting, store, onSetting, optRange, optSelect, optCheck, optHint, bindSettings, optFold, keepFolds, tipHints } from "./ui.mjs";
import { previewBrush, clearDistricts, readForm } from "../districts.mjs";
import { DistrictsList } from "../panel.mjs";
import { swatchesHtml, wireSwatches } from "../tools.mjs";
import { fg, fgGroup, labelFieldsHtml, wireFontPreview } from "../labels.mjs";
import { lightsCfg, lightFieldsHtml, wireLightFields, previewWhileOpen } from "../lights.mjs";
import { sceneForm, sf, N } from "./scene-form.mjs";
import { dotsCfg, dotsFieldsHtml, readDotsValues, wireDotsFields } from "../dots.mjs";

/**
 * Districts: point, paint, erase and clear (tools of the bar), the brush's size, colour, fill, border and merge (its options), and the full brush
 * options and the list of districts (dock). The brush options used to be a dialog with Apply; every change now applies at once and the
 * ring under the cursor shows a size while its slider is being dragged.
 */

const PICK = "mm-district-pick", PAINT = "mm-district", ERASE = "mm-district-erase";
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const borders = () => [["solid", T("District.solid")], ["dashed", T("District.dashed")], ["none", T("District.borderNone")]];
const fills = () => [["soft", T("District.soft")], ["hatch", T("District.hatch")], ["paper", T("District.paper")], ["dots", T("District.dots")]];
const sizeRange = (value) => ({ name: "size", label: T("WS.size"), value, min: 0.2, max: 4, step: 0.1, hint: T("District.sizeHint") });

/** While a size slider is dragged, the ring shows it; on release the value is stored and the preview ends. */
const ringPreview = (name, value) => { if ( name === "size" ) previewBrush({ districtSize: clamp(Number(value) || 0.7, 0.2, 4), districtColor: setting("districtColor") }); };
const sizeSpec = { key: "districtSize", read: (c) => { previewBrush(null); return clamp(Number(c.value) || 0.7, 0.2, 4); } };

/** Colour swatches (with "no colour") bound to the brush colour; the ring takes the colour at once. */
function colorGroup(host) {
  const pick = host.querySelector('[name="pick"]');
  wireSwatches(host, pick);
  pick.addEventListener("change", () => store("districtColor", pick.value).then(() => previewBrush(null)));
  return onSetting(["districtColor"], () => {
    const v = setting("districtColor"); pick.value = v;
    host.querySelectorAll(".mm-swatch").forEach((x) => { const on = x.dataset.color === v; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); });
    // the brush in the bar wears the colour it paints with
    document.querySelector(`#moinen-maps-workspace .mm-ws-toolbtn[data-tool="${PAINT}"]`)?.style.setProperty("--mm-tool", v === "none" ? "" : v);
  });
}

function districtsBar(host, ctx) {
  if ( ctx.tool === PICK ) { host.innerHTML = optHint(T("WS.districtPickHint")); return; }
  const erase = ctx.tool === ERASE;
  host.innerHTML = erase ? `${optRange(sizeRange(setting("districtSize")))}${optHint(T("WS.eraseHint"))}`
    : `${optRange(sizeRange(setting("districtSize")))}
      <div class="mm-ws-opt mm-ws-colors" role="group" aria-label="${esc(T("Editor.color"))}"><span class="mm-ws-label" aria-hidden="true">${esc(T("WS.color"))}</span>${swatchesHtml(setting("districtColor"), false, true)}<input type="hidden" name="pick" value="${esc(setting("districtColor"))}"></div>
      ${optSelect({ name: "fill", label: T("District.fill"), value: setting("districtFill"), options: fills() })}
      ${optSelect({ name: "border", label: T("District.border"), value: setting("districtBorder"), options: borders() })}
      ${optCheck({ name: "merge", label: T("WS.merge"), checked: setting("districtMerge"), hint: T("Tool.districtMerge") })}
      ${optHint(T("WS.brushHint"))}`;
  const offs = [bindSettings(host, { size: sizeSpec, fill: "districtFill", border: "districtBorder", merge: "districtMerge" }, { onInput: ringPreview })];
  if ( !erase ) offs.push(colorGroup(host));
  return () => { offs.forEach((f) => f()); previewBrush(null); };
}

// which folding groups of the brush panel are open (kept while the panel is mounted again)
const brushFolds = new Set();

/** The dock's brush panel: everything the old brush dialog had, applied as it changes. */
function brushPanel(host) {
  const sel = (name, val, opts) => `<select name="${name}">${opts.map(([v, l]) => `<option value="${v}"${v === val ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const o = setting;
  if ( o("districtFill") === "dots" ) brushFolds.add("dots");
  host.innerHTML = `<div class="mm-ws-form">
    ${fg(T("District.size"), `<range-picker name="size" value="${o("districtSize")}" min="0.2" max="4" step="0.1"></range-picker>`, T("District.sizeHint"))}
    ${fgGroup(T("Editor.color"), swatchesHtml(o("districtColor"), false, true))}
    ${fg(T("District.fill"), sel("fill", o("districtFill"), fills()))}
    ${fg(T("District.border"), sel("border", o("districtBorder"), borders()))}
    ${fg(T("District.opacity"), `<range-picker name="opacity" value="${o("districtOpacity")}" min="0" max="1" step="0.05"></range-picker>`)}
    ${fg(T("WS.merge"), `<input type="checkbox" name="merge"${o("districtMerge") ? " checked" : ""}>`, T("Tool.districtMerge"))}
    ${optFold({ id: "dots", title: T("Dots.section"), icon: "fa-solid fa-braille", open: brushFolds, cls: "mm-dotsfold", body: dotsFieldsHtml("bd_", dotsCfg({ dots: o("districtDots") })) })}
    ${optFold({ id: "ink", title: T("District.inkSection"), icon: "fa-solid fa-pen-nib", open: brushFolds, body: `
      ${fg(T("District.ink"), `${sel("ink", o("districtInk"), [["ink", T("District.inkDark")], ["match", T("District.inkMatch")], ["custom", T("District.inkCustom")]])}<color-picker name="inkColor" value="${esc(o("districtInkColor"))}"></color-picker>`)}
      ${fg(T("District.inkOpacity"), `<range-picker name="inkOpacity" value="${o("districtInkOpacity")}" min="0" max="1" step="0.05"></range-picker>`)}
      ${fg(T("District.inkWidth"), `<range-picker name="inkWidth" value="${o("districtInkWidth")}" min="0.2" max="4" step="0.1"></range-picker>`)}` })}
    <input type="hidden" name="pick" value="${esc(o("districtColor"))}"></div>`;
  tipHints(host);
  const offFolds = keepFolds(host, brushFolds);
  wireDotsFields(host, "bd_");
  // the custom outline colour only matters with "custom" ink; the dot options only with the dots fill
  const dep = () => {
    host.querySelector('[name="inkColor"]').hidden = host.querySelector('[name="ink"]').value !== "custom";
    host.querySelector(".mm-dotsfold").hidden = host.querySelector('[name="fill"]').value !== "dots";
  };
  const onDots = (ev) => {
    if ( ev.target.name === "fill" && ev.target.value === "dots" ) host.querySelector(".mm-dotsfold").open = true;
    dep();
    if ( String(ev.target.name ?? "").startsWith("bd_") ) store("districtDots", readDotsValues(readForm(host), "bd_"));
  };
  host.addEventListener("change", onDots);
  dep();
  const num = (key, lo, hi) => ({ key, read: (c) => clamp(Number(c.value), lo, hi) });
  const offs = [
    bindSettings(host, { size: sizeSpec, border: "districtBorder", fill: "districtFill", opacity: num("districtOpacity", 0, 1), ink: "districtInk", inkColor: "districtInkColor",
      inkOpacity: num("districtInkOpacity", 0, 1), inkWidth: num("districtInkWidth", 0.2, 4), merge: "districtMerge" }, { onInput: ringPreview }),
    colorGroup(host),
    // the fill or the outline changed elsewhere (the bar, the [ ] keys): the rows that depend on them follow
    onSetting(["districtFill", "districtInk"], () => queueMicrotask(dep))
  ];
  return () => { offs.forEach((f) => f()); offFolds(); host.removeEventListener("change", onDots); previewBrush(null); };
}

// which folds of the scene panels are open (kept while they are drawn again)
const sceneFolds = new Set();

/**
 * How the districts of the viewed scene behave and look by default (the scene's own config, GM only): hover, attributes and the
 * player list first; the default look, halftone dots and label typography folded. Districts with their own values keep them.
 */
function scenePanel(host) {
  return sceneForm(host, {
    folds: sceneFolds,
    deps: [
      ['[data-dep="hoverColor"]', (v) => v("hoverMode") === "highlight"],   // only the highlight effect uses a colour
      ['[data-dep="hoverStrength"]', (v) => v("hoverMode") !== "none"],
      ['[data-dep="inkColor"]', (v) => v("districtInk") === "custom"]
    ],
    html: (c) => `${sf.select(c, "hoverMode", "Hover.mode", [["none", T("Hover.none")], ["saturate", T("Hover.saturate")], ["highlight", T("Hover.highlight")], ["map", T("Hover.map")]], "Hover.hint")}
      <div data-dep="hoverColor">${sf.color(c, "hoverColor", "Hover.color", "#ffd36b", "Hover.colorHint")}</div>
      <div data-dep="hoverStrength">${sf.range(c, "hoverStrength", "Hover.strength", 0, 1, 0.05, "Hover.strengthHint")}</div>
      ${sf.select(c, "attrDisplay", "Attr.mode", [["off", T("Attr.modeOff")], ["hover", T("Attr.modeHover")], ["always", T("Attr.modeAlways")]], "Attr.modeHint")}
      ${sf.check(c, "districtListForPlayers", "Panel.players", "Panel.playersHint")}
      ${optFold({ id: "look", title: T("Scene.DistrictLook"), icon: "fa-solid fa-pen-nib", open: sceneFolds, body: `
        ${sf.range(c, "districtOpacity", "District.opacityDefault", 0, 1, 0.05, "District.opacityHint")}
        ${sf.select(c, "districtInk", "District.ink", [["ink", T("District.inkDark")], ["match", T("District.inkMatch")], ["custom", T("District.inkCustom")]])}
        <div data-dep="inkColor">${sf.color(c, "districtInkColor", "District.inkCustomColor", "#15110f")}</div>
        ${sf.range(c, "districtInkOpacity", "District.inkOpacity", 0, 1, 0.05)}
        ${sf.range(c, "districtInkWidth", "District.inkWidth", 0.2, 4, 0.1)}
        ${sf.check(c, "districtNoBorder", "District.noOutline", "District.noOutlineHint")}
        ${sf.check(c, "districtNoColor", "District.noColor", "District.noColorHint")}` })}
      ${optFold({ id: "dots", title: T("Scene.Dots"), icon: "fa-solid fa-braille", open: sceneFolds, body: dotsFieldsHtml(`${N}.dots.`, c.dots) })}
      ${optFold({ id: "labels", title: T("Label.sceneSection"), icon: "fa-solid fa-font", open: sceneFolds, body: labelFieldsHtml(`${N}.label.`, c.label) })}`,
    wire: (form) => { wireDotsFields(form, `${N}.dots.`); wireFontPreview(form, `${N}.label.`); }
  });
}

/**
 * Night lights of the viewed scene (GM only): whether districts light up, when the night comes, and the default look of the lights.
 * While the look fold is open the scene shows its lights as at night, as the Scene Config fold did.
 */
function nightPanel(host) {
  return sceneForm(host, {
    folds: sceneFolds,
    deps: [['[data-dep="nightAuto"]', (v) => v("nightMode") === "auto"]],   // thresholds only matter when following the darkness
    html: (c, scene) => `${sf.check(c, "lights.on", "Night.sceneOn", "Night.sceneOnHint")}
      ${sf.select(c, "nightMode", "Night.mode", [["auto", T("Night.modeAuto")], ["on", T("Night.modeOn")], ["off", T("Night.modeOff")]], "Night.modeHint")}
      <div data-dep="nightAuto">${sf.range(c, "nightStart", "Night.start", 0, 1, 0.05, "Night.startHint")}${sf.range(c, "nightFull", "Night.full", 0, 1, 0.05, "Night.fullHint")}</div>
      ${optFold({ id: "nightlook", title: T("Night.lookFold"), icon: "fa-solid fa-lightbulb", open: sceneFolds, cls: "mm-nightlook", attrs: `data-tooltip="${esc(T("Night.scenePreviewHint"))}"`,
        body: lightFieldsHtml(`${N}.lights.`, lightsCfg({}, scene)) })}`,
    wire: (form) => { wireLightFields(form, `${N}.lights.`); return previewWhileOpen(form.querySelector(".mm-nightlook"), "*"); }
  });
}

registerSection({
  id: "districts", order: 2, title: "MOINENMAPS.WS.districts", icon: "fa-solid fa-draw-polygon", color: "#e0a21a",
  activeTool: PICK,
  tools: () => [
    { name: PICK, order: 1, title: "MOINENMAPS.WS.districtPick", icon: "fa-solid fa-arrow-pointer" },
    { name: PAINT, order: 2, title: "MOINENMAPS.Tool.district", icon: "fa-solid fa-paintbrush", color: setting("districtColor") === "none" ? "" : setting("districtColor") },
    { name: ERASE, order: 3, title: "MOINENMAPS.Tool.districtErase", icon: "fa-solid fa-eraser" },
    { name: "mm-district-clear", order: 9, title: "MOINENMAPS.Tool.districtClear", icon: "fa-solid fa-broom", button: true, onClick: () => clearDistricts() }
  ],
  bar: districtsBar,
  panels: [
    { id: "brush", title: "MOINENMAPS.WS.pBrush", icon: "fa-solid fa-paintbrush", mount: (host) => brushPanel(host) },
    { id: "list", title: "MOINENMAPS.WS.pList", icon: "fa-solid fa-list-ul", mount: (host) => new DistrictsList().mount(host) },
    { id: "scene", title: "MOINENMAPS.WS.pDistrictScene", icon: "fa-solid fa-map", open: false, mount: (host) => scenePanel(host) },
    { id: "night", title: "MOINENMAPS.Scene.Night", icon: "fa-solid fa-moon", open: false, mount: (host) => nightPanel(host) }
  ]
});
