import { toggleDistrictsPanel, playersMayList } from "./panel.mjs";
import { registerDistrictSettings } from "./districts.mjs";
import { MODULE_ID, PIN_COLORS, pinTypeOf, findPinType, allPresets, presetLabel, typeLabel } from "./config.mjs";
import { syncTool as syncWaterTool, registerWaterEditorSettings } from "./water/editor.mjs";
import { syncRodTool, registerRodSettings } from "./water/rods.mjs";
import { registerPresetSettings, currentPinType, refreshToolButton } from "./presets.mjs";
import { fg, fgGroup, fitDialog, liveBarHtml, wireLiveBar, frameThrottle } from "./labels.mjs";
import { GROUP, sections, sectionTool, activeSection } from "./workspace/registry.mjs";
import { registerWorkspaceSettings, syncWorkspace, workspaceTool, useTool } from "./workspace/shell.mjs";

const PIN_TOOL = "mm-pin";
const T = (k) => game.i18n.localize(`MOINENMAPS.${k}`);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/** The tool in hand in the open workspace section (see workspace/shell.mjs), else "". Tool names are unique across sections. */
export const activeToolName = () => workspaceTool();
/** The pin type the placing tool will drop (the palette's selection), or null while another tool is active. */
export const activePinType = () => activeToolName() === PIN_TOOL ? currentPinType() : null;
const pickedColor = () => { try { return game.settings.get(MODULE_ID, "pinColor") || ""; } catch { return ""; } };

export function registerSettings() {
  registerDistrictSettings();
  registerPresetSettings();
  registerWaterEditorSettings();
  registerRodSettings();
  registerWorkspaceSettings();
  // the placing tool wears the picked colour
  game.settings.register(MODULE_ID, "pinColor", { scope: "client", config: false, type: String, default: "", onChange: () => refreshToolButton() });
}

/* ---------------------------------------------------------------------------------------------- */
/*  Toolbar                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

/**
 * One button in the first column of the scene controls ("Moinen Maps Tools"); its second column lists the sections (Pins, Districts,
 * Water, and the ones still to come). The tools of a section are in the workspace bar across the top of the canvas.
 */
export function onGetSceneControlButtons(controls) {
  const base = { name: GROUP, order: 8.5, title: "MOINENMAPS.WS.group", icon: "fa-solid fa-location-dot", layer: "notes" };
  if ( !game.user.isGM ) {
    // players get a read-only list of revealed districts, only when the scene allows it, and the VRAM meter's toggle (bar-toggles.mjs)
    const tools = {};
    if ( playersMayList() ) tools.districtsList = { name: "districtsList", order: 1, title: "MOINENMAPS.Tool.districtsList", icon: "fa-solid fa-list-ul", button: true, onChange: () => toggleDistrictsPanel() };
    controls[GROUP] = { ...base, tools };
    return;
  }
  const tools = {};
  for ( const s of sections() ) {
    const name = sectionTool(s);
    tools[name] = { name, order: s.order, icon: s.icon,
      title: s.soon ? game.i18n.format("MOINENMAPS.WS.soonTitle", { section: game.i18n.localize(s.title) }) : s.title };
  }
  controls[GROUP] = {
    ...base, tools, activeTool: sectionTool(sections()[0]),
    onChange: (event, active) => {
      // Activating the notes layer makes SceneControls jump to the core "notes" group, so hop back to ours afterwards.
      if ( active && !canvas.notes.active ) { canvas.notes.activate(); setTimeout(() => ui.controls.activate({ control: GROUP }), 50); }
      if ( !active ) setTimeout(syncWorkspace, 0);   // leaving for a group of Foundry's own
    },
    onToolChange: (_event, _tool, active) => { if ( active ) syncWorkspace(); }
  };
}

/** The tool in hand changed (hook "moinenMapsTool"): the notes layer, the cursor classes and the water overlays follow it. */
export function onWorkspaceTool(tool) {
  if ( !canvas.ready ) return;
  canvas.notes.setAllRenderFlags({ refreshState: true });
  const def = activeSection()?.tools?.().find((t) => t.name === tool);
  if ( !def?.control ) canvas.notes.releaseAll();
  document.body.classList.toggle("mm-placing", !!activePinType());
  syncWaterTool(); syncRodTool();
}

/** Colour the sections in the second column (CSS custom property per section) and follow the controls with the workspace. */
export function onRenderSceneControls() {
  const root = ui.controls?.element;
  if ( !root ) return;
  if ( game.user.isGM ) for ( const s of sections() ) {
    const b = root.querySelector(`button.tool[data-tool="${sectionTool(s)}"]`); if ( !b ) continue;
    if ( s.color ) b.style.setProperty("--mm-tool", s.color);
    b.classList.add("mm-section"); b.classList.toggle("mm-soon", !!s.soon);
  }
  syncWorkspace();
  syncWaterTool(); syncRodTool();
  document.body.classList.toggle("mm-placing", !!activePinType());
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
    useTool("pins", "select");
  }, true);
}

/* ---------------------------------------------------------------------------------------------- */
/*  Swatches and the pin editor                                                                    */
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

/** Label / type / colour editor for a standalone pin. */
export async function openPinEditor(doc) {
  const type = pinTypeOf(doc), color = doc.flags?.[MODULE_ID]?.color ?? "";
  const DialogV2 = foundry.applications.api.DialogV2;
  // live: edits go into the document's local source only (updateSource writes nothing to the database), the pin redraws, Cancel restores it
  const snap = { text: doc.text, global: doc.global, src: doc.texture.src, pin: type.id, color: doc.flags?.[MODULE_ID]?.color };
  const colorEntry = (c) => c ? { [`flags.${MODULE_ID}.color`]: c } : { [`flags.${MODULE_ID}.-=color`]: null };
  const draw = () => { const n = doc.object; n?.renderFlags?.set({ refresh: true }); };
  const draft = (v) => { doc.updateSource({ text: v.text, global: v.global, "texture.src": findPinType(v.pin)?.icon ?? snap.src, [`flags.${MODULE_ID}.pin`]: v.pin, ...colorEntry(v.color) }); draw(); };
  let committed = false, reopen = false, dlgRef = null, done = false;
  const live = frameThrottle(() => {
    const form = dlgRef?.element?.querySelector("form"); if ( done || !form || !dlgRef.element.isConnected ) return;
    const f = form.elements; draft({ text: f.text.value.trim(), global: f.global.checked, pin: f.type.value, color: f.pick.value });
  });
  const typeOpts = allPresets().map((p) => `<optgroup label="${esc(presetLabel(p))}">${p.types.map((t) => `<option value="${esc(t.id)}"${t.id === type.id ? " selected" : ""}>${esc(typeLabel(t))}</option>`).join("")}</optgroup>`).join("");
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
          text: f.text.value.trim(), global: f.global.checked, texture: { src: findPinType(f.type.value)?.icon ?? type.icon },
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

/** Delete every standalone pin of the scene (after a confirmation). */
export async function clearPins() {
  const ids = canvas.scene.notes.filter((n) => pinTypeOf(n) && !n.entryId).map((n) => n.id);
  if ( !ids.length ) return ui.notifications.info(T("Clear.none"));
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: T("Tool.clear") }, content: `<p>${esc(game.i18n.format("MOINENMAPS.Clear.confirm", { n: ids.length }))}</p>`
  });
  if ( ok ) await canvas.scene.deleteEmbeddedDocuments("Note", ids);
}

