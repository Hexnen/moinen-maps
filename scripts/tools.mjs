import { toggleDistrictsPanel, playersMayList } from "./panel.mjs";
import { openBrushOptions, clearDistricts, registerDistrictSettings } from "./districts.mjs";
import { MODULE_ID, PIN_TYPES, PIN_COLORS, pinTypeOf } from "./config.mjs";
import { fg, fgGroup, fitDialog, liveBarHtml, wireLiveBar, frameThrottle } from "./labels.mjs";

const GROUP = "moinenmaps";
const PREFIX = "mm-";
const T = (k) => game.i18n.localize(`MOINENMAPS.${k}`);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

export const activeToolName = () => ui.controls?.control?.name === GROUP ? (ui.controls.tool?.name ?? "") : "";
export const activePinType = () => {
  const n = activeToolName();
  return n.startsWith(PREFIX) ? PIN_TYPES.find((t) => PREFIX + t.id === n) ?? null : null;
};
const pickedColor = () => { try { return game.settings.get(MODULE_ID, "pinColor") || ""; } catch { return ""; } };

export function registerSettings() {
  registerDistrictSettings();
  game.settings.register(MODULE_ID, "pinColor", { scope: "client", config: false, type: String, default: "", onChange: syncColorVar });
}

/** Expose the picked colour to CSS (toolbar swatch) */
export function syncColorVar() {
  document.documentElement.style.setProperty("--mm-pick", pickedColor() || "transparent");
  document.documentElement.classList.toggle("mm-has-pick", !!pickedColor());
}

/* ---------------------------------------------------------------------------------------------- */
/*  Toolbar                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

export function onGetSceneControlButtons(controls) {
  if ( !game.user.isGM ) {
    // players only get a read-only list of revealed districts, and only when the scene allows it
    if ( !playersMayList() ) return;
    controls[GROUP] = { name: GROUP, order: 8.5, title: "MOINENMAPS.Group", icon: "fa-solid fa-location-dot", layer: "notes", tools: {
      districtsList: { name: "districtsList", order: 1, title: "MOINENMAPS.Tool.districtsList", icon: "fa-solid fa-list-ul", button: true, onChange: () => toggleDistrictsPanel() } } };
    return;
  }
  const tools = {
    select: { name: "select", order: 1, title: "MOINENMAPS.Tool.select", icon: "fa-solid fa-expand", interaction: true, control: true }
  };
  PIN_TYPES.forEach((t, i) => {
    tools[PREFIX + t.id] = {
      name: PREFIX + t.id, order: 10 + i, title: `MOINENMAPS.Type.${t.id}`, icon: `fa-solid ${t.fa}`,
      interaction: true, control: true
    };
  });
  const dist = { interaction: true, control: true };
  tools["mm-district"] = { ...dist, name: "mm-district", order: 30, title: "MOINENMAPS.Tool.district", icon: "fa-solid fa-paintbrush" };
  tools["mm-district-erase"] = { ...dist, name: "mm-district-erase", order: 31, title: "MOINENMAPS.Tool.districtErase", icon: "fa-solid fa-eraser" };
  tools["mm-district-merge"] = { name: "mm-district-merge", order: 32, title: "MOINENMAPS.Tool.districtMerge", icon: "fa-solid fa-object-group", toggle: true,
    active: game.settings.get(MODULE_ID, "districtMerge"), onChange: (_e, on) => game.settings.set(MODULE_ID, "districtMerge", on) };
  tools["mm-district-opts"] = { name: "mm-district-opts", order: 33, title: "MOINENMAPS.Tool.districtOpts", icon: "fa-solid fa-sliders", button: true, onChange: () => openBrushOptions() };
  tools["mm-districts-list"] = { name: "mm-districts-list", order: 34, title: "MOINENMAPS.Tool.districtsList", icon: "fa-solid fa-list-ul", button: true, onChange: () => toggleDistrictsPanel() };
  tools["mm-district-clear"] = { name: "mm-district-clear", order: 61, title: "MOINENMAPS.Tool.districtClear", icon: "fa-solid fa-broom", button: true, onChange: () => clearDistricts() };
  tools.color = { name: "color", order: 17, title: "MOINENMAPS.Tool.color", icon: "fa-solid fa-palette", button: true,
    onChange: () => openColorDialog() };
  tools.clear = { name: "clear", order: 60, title: "MOINENMAPS.Tool.clear", icon: "fa-solid fa-trash", button: true,
    onChange: () => clearPins() };
  controls[GROUP] = {
    name: GROUP, order: 8.5, title: "MOINENMAPS.Group", icon: "fa-solid fa-location-dot", layer: "notes",
    onChange: (event, active) => {
      // Activating the notes layer makes SceneControls jump to the core "notes" group, so hop back to ours afterwards.
      if ( active && !canvas.notes.active ) { canvas.notes.activate(); setTimeout(() => ui.controls.activate({ control: GROUP }), 50); }
    },
    onToolChange: (_event, tool, active) => {
      canvas.notes.setAllRenderFlags({ refreshState: true });
      if ( active && !tool.control ) canvas.notes.releaseAll();
      document.body.classList.toggle("mm-placing", !!activePinType());
    },
    tools,
    activeTool: "select"
  };
}

/** Colour the toolbar buttons with their pin colour (CSS custom property per tool). */
export function onRenderSceneControls() {
  const root = ui.controls?.element;
  if ( !root ) return;
  for ( const t of PIN_TYPES ) {
    const b = root.querySelector(`button.tool[data-tool="${PREFIX}${t.id}"]`);
    if ( b ) b.style.setProperty("--mm-tool", t.color);
  }
  document.body.classList.toggle("mm-placing", !!activePinType());
  syncColorVar();
}

/* ---------------------------------------------------------------------------------------------- */
/*  Placement                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

export async function placePin(type, origin, { snap = true, color } = {}) {
  const layer = canvas.notes;
  let p = { x: origin.x, y: origin.y };
  if ( snap ) p = layer.getSnappedPoint(p);
  if ( !canvas.dimensions.rect.contains(p.x, p.y) ) return null;
  const data = {
    x: Math.round(p.x), y: Math.round(p.y), entryId: null, author: null, text: "",
    texture: { src: type.icon }, iconSize: 40, sort: Math.max(layer.getMaxSort() + 1, 0),
    flags: { [MODULE_ID]: { pin: type.id, ...((color || pickedColor()) ? { color: color || pickedColor() } : {}) } }
  };
  const [doc] = await canvas.scene.createEmbeddedDocuments("Note", [data]);
  return doc;
}

function onLayerClick(wrapped, event) {
  const type = game.user.isGM ? activePinType() : null;
  if ( !type || canvas.notes.hover ) return wrapped(event);
  if ( game.paused && !game.user.isGM ) return;
  const origin = event.getLocalPosition(canvas.stage);
  return placePin(type, origin, { snap: !event.shiftKey });
}

/** Double-click on a standalone pin edits it instead of silently doing nothing. */
function onNoteDblClick(wrapped, event) {
  const doc = this.document;
  if ( pinTypeOf(doc) && !doc.entryId ) {
    if ( game.user.isGM ) openPinEditor(doc);
    return;
  }
  return wrapped(event);
}

let patched = false;
export function installPatches() {
  if ( patched ) return;
  patched = true;
  const lw = game.modules.get("lib-wrapper")?.active ? globalThis.libWrapper : null;
  const NotesLayer = foundry.canvas.layers.NotesLayer, Note = foundry.canvas.placeables.Note;
  if ( lw ) {
    lw.register(MODULE_ID, "foundry.canvas.layers.NotesLayer.prototype._onClickLeft", function(w, ...a) { return onLayerClick.call(this, w, ...a); }, "MIXED");
    lw.register(MODULE_ID, "foundry.canvas.placeables.Note.prototype._onClickLeft2", function(w, ...a) { return onNoteDblClick.call(this, w, ...a); }, "MIXED");
  } else {
    for ( const [proto, name, fn] of [[NotesLayer.prototype, "_onClickLeft", onLayerClick], [Note.prototype, "_onClickLeft2", onNoteDblClick]] ) {
      if ( proto[name].__mm ) continue;
      const orig = proto[name];
      proto[name] = Object.assign(function(...a) { return fn.call(this, orig.bind(this), ...a); }, { __mm: true });
    }
  }
  // Escape leaves the placing tool (the tool otherwise stays active so several pins can be dropped in a row)
  window.addEventListener("keydown", (ev) => {
    if ( ev.key !== "Escape" || !activePinType() ) return;
    if ( document.querySelector("dialog[open], .application.dialog") ) return;
    ev.preventDefault(); ev.stopPropagation();
    ui.controls.activate({ tool: "select" });
  }, true);
}

/* ---------------------------------------------------------------------------------------------- */
/*  Dialogs                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

export function swatchesHtml(current, withDefault = true, withNone = false) {
  return `<div class="mm-swatches">${(withDefault ? [""] : []).concat(withNone ? ["none"] : [], PIN_COLORS).map((c) =>
    `<button type="button" class="mm-swatch${c === current ? " on" : ""}" data-color="${c}" aria-pressed="${c === current}" ${c && c !== "none" ? `style="--c:${c}"` : ""} aria-label="${esc(c === "none" ? T("ColorNone") : c || T("ColorDefault"))}" data-tooltip="${esc(c === "none" ? T("ColorNone") : c || T("ColorDefault"))}">${c === "none" ? '<i class="fa-solid fa-ban" inert></i>' : c ? "" : '<i class="fa-solid fa-wand-magic-sparkles" inert></i>'}</button>`).join("")}</div>`;
}
export function wireSwatches(el, input) {
  el.querySelectorAll(".mm-swatch").forEach((b) => b.addEventListener("click", () => {
    el.querySelectorAll(".mm-swatch").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); });
    input.value = b.dataset.color; input.dispatchEvent(new Event("change", { bubbles: true }));
  }));
}

/** Choose the colour used for the next pins you drop ("" = each type's own colour). */
export async function openColorDialog() {
  const cur = pickedColor();
  const DialogV2 = foundry.applications.api.DialogV2;
  let reopen = false, done = false;
  try {
  await DialogV2.prompt({
    window: { title: T("Tool.color"), icon: "fa-solid fa-palette" },
    classes: ["moinen-maps-dialog"],
    position: { width: 340 },
    content: `${liveBarHtml()}<p class="hint">${esc(T("ColorHint"))}</p>${swatchesHtml(cur)}
      ${fg(T("ColorCustom"), `<color-picker name="color" value="${esc(cur || "#e5322d")}"></color-picker>`)}
      <input type="hidden" name="pick" value="${esc(cur)}">`,
    render: (_ev, dlg) => {
      const el = dlg.element, pick = el.querySelector('[name="pick"]');
      wireSwatches(el, pick); fitDialog(dlg);
      // live: the toolbar's colour tool wears the colour being chosen
      const show = frameThrottle(() => { if ( done ) return; const v = pick.value; document.documentElement.style.setProperty("--mm-pick", v || "transparent"); document.documentElement.classList.toggle("mm-has-pick", !!v); });
      for ( const ev of ["input", "change", "click"] ) el.addEventListener(ev, show);
      wireLiveBar(el, () => { reopen = true; dlg.close(); });
      el.querySelector('color-picker[name="color"]').addEventListener("change", (e) => {
        pick.value = e.target.value; el.querySelectorAll(".mm-swatch").forEach((x) => { x.classList.remove("on"); x.setAttribute("aria-pressed", "false"); });
      });
    },
    ok: {
      label: T("Apply"), icon: "fa-solid fa-check",
      callback: (_ev, button) => game.settings.set(MODULE_ID, "pinColor", button.form.elements.pick.value || "")
    },
    rejectClose: false
  });
  } finally { done = true; syncColorVar(); }   // discards the preview unless Apply stored a new colour
  if ( reopen ) openColorDialog();
}

/** Label / type / colour editor for a standalone pin. */
export async function openPinEditor(doc) {
  const type = pinTypeOf(doc), color = doc.flags?.[MODULE_ID]?.color ?? "";
  const DialogV2 = foundry.applications.api.DialogV2;
  // live: edits go into the document's local source only (updateSource writes nothing to the database), the pin redraws, Cancel restores it
  const snap = { text: doc.text, global: doc.global, src: doc.texture.src, pin: type.id, color: doc.flags?.[MODULE_ID]?.color };
  const colorEntry = (c) => c ? { [`flags.${MODULE_ID}.color`]: c } : { [`flags.${MODULE_ID}.-=color`]: null };
  const draw = () => { const n = doc.object; n?.renderFlags?.set({ refresh: true }); };
  const draft = (v) => { doc.updateSource({ text: v.text, global: v.global, "texture.src": PIN_TYPES.find((t) => t.id === v.pin)?.icon ?? snap.src, [`flags.${MODULE_ID}.pin`]: v.pin, ...colorEntry(v.color) }); draw(); };
  let committed = false, reopen = false, dlgRef = null, done = false;
  const live = frameThrottle(() => {
    const form = dlgRef?.element?.querySelector("form"); if ( done || !form || !dlgRef.element.isConnected ) return;
    const f = form.elements; draft({ text: f.text.value.trim(), global: f.global.checked, pin: f.type.value, color: f.pick.value });
  });
  const typeOpts = PIN_TYPES.map((t) => `<option value="${t.id}"${t.id === type.id ? " selected" : ""}>${esc(T(`Type.${t.id}`))}</option>`).join("");
  try {
  await DialogV2.prompt({
    window: { title: T("Editor.title"), icon: "fa-solid fa-location-dot" },
    classes: ["moinen-maps-dialog"],
    position: { width: 360 },
    content: `${liveBarHtml()}${fg(T("Editor.label"), `<input type="text" name="text" value="${esc(doc.text)}" autofocus>`, T("Editor.labelHint"))}
      ${fg(T("Editor.type"), `<select name="type">${typeOpts}</select>`)}
      ${fgGroup(T("Editor.color"), swatchesHtml(color))}
      ${fg(T("EditorGlobal"), `<input type="checkbox" name="global"${doc.global ? " checked" : ""}>`, T("EditorGlobalHint"))}
      <input type="hidden" name="pick" value="${esc(color)}">`,
    render: (_ev, dlg) => {
      const el = dlg.element; dlgRef = dlg;
      wireSwatches(el, el.querySelector('[name="pick"]')); fitDialog(dlg);
      for ( const ev of ["input", "change", "click"] ) el.addEventListener(ev, live);
      wireLiveBar(el, () => { reopen = true; dlg.close(); });
    },
    ok: {
      label: T("Apply"), icon: "fa-solid fa-check",
      callback: async (_ev, button) => {
        const f = button.form.elements;
        committed = true;
        // diff:false because the draft already sits in the local source; this is the single database write
        await doc.update({
          text: f.text.value.trim(), global: f.global.checked, texture: { src: PIN_TYPES.find((t) => t.id === f.type.value)?.icon ?? type.icon },
          [`flags.${MODULE_ID}.pin`]: f.type.value,
          [`flags.${MODULE_ID}.color`]: f.pick.value || null
        }, { diff: false });
      }
    },
    rejectClose: false
  });
  } finally {
    done = true;
    if ( !committed && doc.collection?.has(doc.id) ) { doc.updateSource({ text: snap.text, global: snap.global, "texture.src": snap.src, [`flags.${MODULE_ID}.pin`]: snap.pin, ...colorEntry(snap.color) }); draw(); }
  }
  if ( reopen ) openPinEditor(doc);
}

async function clearPins() {
  const ids = canvas.scene.notes.filter((n) => pinTypeOf(n) && !n.entryId).map((n) => n.id);
  if ( !ids.length ) return ui.notifications.info(T("Clear.none"));
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: T("Tool.clear") }, content: `<p>${esc(game.i18n.format("MOINENMAPS.Clear.confirm", { n: ids.length }))}</p>`
  });
  if ( ok ) await canvas.scene.deleteEmbeddedDocuments("Note", ids);
}

