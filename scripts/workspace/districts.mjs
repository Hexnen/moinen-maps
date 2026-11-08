import { registerSection } from "./registry.mjs";
import { esc, T, setting, store, onSetting, optRange, optSelect, optCheck, optHint, bindSettings, optFold, keepFolds, tipHints } from "./ui.mjs";
import { previewBrush, clearDistricts, readForm } from "../districts.mjs";
import { DistrictsList } from "../panel.mjs";
import { swatchesHtml, wireSwatches } from "../tools.mjs";
import { fg, fgGroup } from "../labels.mjs";
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
    { id: "list", title: "MOINENMAPS.WS.pList", icon: "fa-solid fa-list-ul", mount: (host) => new DistrictsList().mount(host) }
  ]
});
