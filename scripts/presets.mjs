import { MODULE_ID, GLYPHS, DEFAULT_PRESET, allPresets, customPresets, resolvePreset, findPinType, typeLabel, presetLabel, resetPresetCache } from "./config.mjs";
import { compositePin } from "./pin-art.mjs";
import { refreshPins } from "./pin.mjs";
import { fg } from "./labels.mjs";
import { useTool } from "./workspace/shell.mjs";

/**
 * Pin presets: the palette (a docked panel holding one preset's pins) and the preset manager (a docked panel to create / edit /
 * delete custom presets). The preset data and lookups live in config.mjs; this file is the UI and the remembered selection.
 */

const TOOL = "mm-pin";
const T = (k) => game.i18n.localize(`MOINENMAPS.${k}`);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const get = (k) => { try { return game.settings.get(MODULE_ID, k); } catch { return ""; } };

export function registerPresetSettings() {
  const S = game.settings;
  S.register(MODULE_ID, "pinPresets", {
    scope: "world", config: false, type: Array, default: [],
    onChange: () => { resetPresetCache(); if ( canvas?.ready ) refreshPins(); renderPalette(); refreshToolButton(); manager?.reload(); }
  });
  S.register(MODULE_ID, "pinPreset", { scope: "client", config: false, type: String, default: DEFAULT_PRESET, onChange: () => { renderPalette(); refreshToolButton(); } });
  S.register(MODULE_ID, "pinType", { scope: "client", config: false, type: String, default: "", onChange: () => { renderPalette(); refreshToolButton(); } });
}

/* ---------------------------------------------------------------------------------------------- */
/*  Selection                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

/** The preset the palette shows (resolved), falling back to the first one when the stored id no longer exists. */
export function currentPreset() {
  const id = get("pinPreset"), all = allPresets();
  return resolvePreset(all.find((p) => p.id === id) ?? all[0]);
}

/** The pin type the placing tool drops: the remembered one when it is in the current preset, else the preset's first. */
export function currentPinType() {
  const p = currentPreset(), id = get("pinType");
  return p.types.find((t) => t.id === id) ?? p.types[0] ?? findPinType("plain");
}

function selectType(id) {
  const t = findPinType(id); if ( !t ) return;
  game.settings.set(MODULE_ID, "pinPreset", t.preset).then(() => game.settings.set(MODULE_ID, "pinType", id));
}

/** The placing tool wears the colour and glyph icon of the pin it will drop. */
export function refreshToolButton() {
  // the tool lives in the Pins workspace bar (only on screen while the Pins section is open)
  const b = document.querySelector(`#moinen-maps-workspace .mm-ws-toolbtn[data-tool="${TOOL}"]`);
  if ( !b ) return;
  const t = currentPinType(), picked = get("pinColor");
  b.style.setProperty("--mm-tool", picked || t.color);
  const i = b.querySelector(":scope > i"); if ( i ) i.className = `fa-solid ${t.fa}`;
  const tip = `${T("Tool.pin")}: ${typeLabel(t)}`;
  b.setAttribute("aria-label", tip); b.dataset.tooltip = tip;
}

/* ---------------------------------------------------------------------------------------------- */
/*  Palette                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

const thumbs = new Map();
/** A small finished pin as a data URL (rendered once per glyph + colour). */
export function thumb(glyph, color) {
  const key = `${glyph}|${color}`;
  if ( !thumbs.has(key) ) {
    // crop the composite to the pin itself (it sits in a padded cell)
    const full = compositePin(0, color, glyph), out = document.createElement("canvas");
    out.width = 200; out.height = 276;
    out.getContext("2d").drawImage(full, 60, 48, 200, 276, 0, 0, 200, 276);
    thumbs.set(key, out.toDataURL());
  }
  return thumbs.get(key);
}

const palettes = new Set();   // docked palettes on screen (the workspace dock)

/** Redraw every docked palette (the selection or the presets changed). */
function renderPalette() { for ( const host of palettes ) drawPalette(host); }

/**
 * The palette as a docked panel: the preset picker and that preset's pins. Picking a pin selects it and switches to the placing tool.
 * `onManage(presetId)` opens the preset manager. Returns the cleanup.
 */
export function mountPalette(host, { onManage } = {}) {
  host.classList.add("mm-palette");
  palettes.add(host);
  const onChange = (ev) => {
    if ( ev.target.name !== "preset" ) return;
    const p = allPresets().find((x) => x.id === ev.target.value);
    game.settings.set(MODULE_ID, "pinPreset", ev.target.value).then(() => game.settings.set(MODULE_ID, "pinType", p?.types[0]?.id ?? ""));
  };
  const onClick = (ev) => {
    const b = ev.target.closest("button"); if ( !b ) return;
    if ( b.dataset.act === "manage" ) return onManage?.(currentPreset().id);
    if ( !b.dataset.id ) return;
    selectType(b.dataset.id);
    useTool("pins", TOOL);
  };
  host.addEventListener("change", onChange);
  host.addEventListener("click", onClick);
  drawPalette(host);
  return () => { palettes.delete(host); host.removeEventListener("change", onChange); host.removeEventListener("click", onClick); };
}

function drawPalette(host) {
  const cur = currentPinType(), preset = currentPreset();
  const focused = host.contains(document.activeElement) ? document.activeElement.dataset.id ?? document.activeElement.name : null;
  const opts = allPresets().map((p) => `<option value="${esc(p.id)}"${p.id === preset.id ? " selected" : ""}>${esc(presetLabel(p))}</option>`).join("");
  const types = preset.types.map((t) => `<button type="button" class="mm-pal-type${t.id === cur.id ? " on" : ""}" data-id="${esc(t.id)}" aria-pressed="${t.id === cur.id}" style="--c:${t.color}">
      <img src="${thumb(t.glyph, t.color)}" alt="" inert><span>${esc(typeLabel(t))}</span></button>`).join("");
  host.innerHTML = `<div class="mm-pal-head">
      <select name="preset" aria-label="${esc(T("Palette.preset"))}">${opts}</select>
      <button type="button" class="mm-pal-manage" data-act="manage" aria-label="${esc(T("Palette.manage"))}" data-tooltip="${esc(T("Palette.manage"))}"><i class="fa-solid fa-sliders" inert></i></button>
    </div>
    <div class="mm-pal-grid" role="group" aria-label="${esc(presetLabel(preset))}">${types || `<p class="hint">${esc(T("Palette.empty"))}</p>`}</div>`;
  // a redraw (the pick changed) keeps the keyboard where it was
  if ( focused ) host.querySelector(`[data-id="${CSS.escape(focused)}"], [name="${CSS.escape(focused)}"]`)?.focus();
}

/* ---------------------------------------------------------------------------------------------- */
/*  Preset manager                                                                                 */
/* ---------------------------------------------------------------------------------------------- */

const newId = (prefix) => `${prefix}-${foundry.utils.randomID(8)}`;
const glyphLabel = (g) => T(`PinGlyph.${g}`);

let manager = null;   // the docked manager, so the palette can point it at a preset

/**
 * The preset manager as a docked panel: create, edit, duplicate and delete custom presets; built-in presets are shown read-only and can
 * be duplicated. Edits stay a draft (the palette is not disturbed) until Apply; Discard goes back to what is saved. Returns the cleanup.
 */
export function mountPresetManager(host, startId) {
  const DialogV2 = foundry.applications.api.DialogV2;
  const load = () => customPresets().map((p) => ({ id: p.id, name: p.name, types: p.types.map((t) => ({ ...t })) }));
  let draft = load(), dirty = false;
  const all = () => [...allPresets().filter((p) => !p.custom), ...draft.map((p) => ({ ...p, custom: true }))];
  let sel = all().some((p) => p.id === startId) ? startId : currentPreset().id;
  host.classList.add("mm-pm");

  const rowHtml = (t, i, n) => `<div class="mm-pm-row" data-i="${i}">
      <img class="mm-pm-thumb" src="${thumb(t.glyph, t.color)}" alt="" inert>
      <input type="text" name="name" value="${esc(t.name)}" placeholder="${esc(glyphLabel(t.glyph))}" aria-label="${esc(T("Manager.pinName"))}">
      <color-picker name="color" value="${esc(t.color)}" aria-label="${esc(T("Editor.color"))}"></color-picker>
      <select name="glyph" aria-label="${esc(T("Manager.glyph"))}">${Object.keys(GLYPHS).map((g) => `<option value="${g}"${g === t.glyph ? " selected" : ""}>${esc(glyphLabel(g))}</option>`).join("")}</select>
      <button type="button" class="mm-icon" data-act="up" ${i ? "" : "disabled"} aria-label="${esc(T("Attr.up"))}"><i class="fa-solid fa-chevron-up" inert></i></button>
      <button type="button" class="mm-icon" data-act="down" ${i < n - 1 ? "" : "disabled"} aria-label="${esc(T("Attr.down"))}"><i class="fa-solid fa-chevron-down" inert></i></button>
      <button type="button" class="mm-icon mm-danger" data-act="del" aria-label="${esc(T("Attr.remove"))}"><i class="fa-solid fa-xmark" inert></i></button>
    </div>`;
  const roHtml = (t) => `<div class="mm-pm-row mm-pm-ro"><img class="mm-pm-thumb" src="${thumb(t.glyph, t.color)}" alt="" inert><span>${esc(typeLabel(t))}</span><span class="mm-pm-glyph">${esc(glyphLabel(t.glyph))}</span><span class="mm-swatchdot" style="--c:${t.color}"></span></div>`;

  const render = () => {
    const presets = all(), p = presets.find((x) => x.id === sel) ?? presets[0]; sel = p.id;
    const body = p.custom
      ? `${fg(T("Manager.name"), `<input type="text" name="pname" value="${esc(p.name)}">`)}
         <div class="mm-pm-list">${p.types.map((t, i) => rowHtml(t, i, p.types.length)).join("") || `<p class="hint">${esc(T("Palette.empty"))}</p>`}</div>
         <button type="button" class="mm-pm-add" data-act="add"><i class="fa-solid fa-plus" inert></i> ${esc(T("Manager.add"))}</button>`
      : `<p class="hint">${esc(T("Manager.builtinHint"))}</p><div class="mm-pm-list">${resolvePreset(p).types.map(roHtml).join("")}</div>`;
    host.innerHTML = `<div class="mm-pm-bar">
        <select name="preset" aria-label="${esc(T("Palette.preset"))}">${presets.map((x) => `<option value="${esc(x.id)}"${x.id === sel ? " selected" : ""}>${esc(presetLabel(x))}${x.custom ? "" : ` · ${esc(T("Manager.builtin"))}`}</option>`).join("")}</select>
        <button type="button" data-act="new" data-tooltip="${esc(T("Manager.new"))}" aria-label="${esc(T("Manager.new"))}"><i class="fa-solid fa-file-circle-plus" inert></i></button>
        <button type="button" data-act="dup" data-tooltip="${esc(T("Manager.duplicate"))}" aria-label="${esc(T("Manager.duplicate"))}"><i class="fa-solid fa-clone" inert></i></button>
        <button type="button" class="mm-danger" data-act="delete" ${p.custom ? "" : "disabled"} data-tooltip="${esc(T("Manager.delete"))}" aria-label="${esc(T("Manager.delete"))}"><i class="fa-solid fa-trash" inert></i></button>
      </div><div class="mm-pm-body">${body}</div>
      <footer class="mm-pm-foot">
        <span class="mm-pm-state" role="status">${esc(T(dirty ? "WS.unsaved" : "WS.saved"))}</span>
        <button type="button" data-act="discard"${dirty ? "" : " disabled"}><i class="fa-solid fa-rotate-left" inert></i> ${esc(T("WS.discard"))}</button>
        <button type="button" class="mm-primary" data-act="apply"${dirty ? "" : " disabled"}><i class="fa-solid fa-check" inert></i> ${esc(T("Apply"))}</button>
      </footer>`;
  };
  const cur = () => draft.find((x) => x.id === sel);
  const touch = () => {
    if ( dirty ) return;
    dirty = true;
    host.querySelectorAll('[data-act="apply"], [data-act="discard"]').forEach((b) => { b.disabled = false; });
    const st = host.querySelector(".mm-pm-state"); if ( st ) st.textContent = T("WS.unsaved");
  };

  const onInput = (ev) => {
    const p = cur(); if ( !p ) return;
    const t = ev.target;
    if ( t.name === "pname" ) { p.name = t.value; return touch(); }
    const row = t.closest(".mm-pm-row"); if ( !row ) return;
    const type = p.types[Number(row.dataset.i)]; if ( !type ) return;
    if ( t.name === "name" ) type.name = t.value;
    else if ( t.name === "glyph" ) type.glyph = t.value;
    else if ( t.name === "color" ) type.color = t.value;
    else return;
    touch();
    row.querySelector(".mm-pm-thumb").src = thumb(type.glyph, type.color);
    if ( t.name === "glyph" ) row.querySelector('[name="name"]').placeholder = glyphLabel(type.glyph);
  };

  const clean = () => draft.map((p) => ({
    id: p.id, name: p.name.trim() || T("Manager.newName"),
    types: p.types.map((t) => ({ id: t.id, glyph: t.glyph, color: t.color, name: t.name.trim() || glyphLabel(t.glyph) }))
  }));

  const onClick = async (ev) => {
    const b = ev.target.closest("[data-act]"); if ( !b || b.disabled ) return;
    const act = b.dataset.act, p = cur(), row = b.closest(".mm-pm-row"), i = row ? Number(row.dataset.i) : -1;
    if ( act === "apply" ) { dirty = false; await game.settings.set(MODULE_ID, "pinPresets", clean()); draft = load(); return render(); }
    if ( act === "discard" ) { dirty = false; draft = load(); if ( !all().some((x) => x.id === sel) ) sel = currentPreset().id; return render(); }
    if ( act === "new" ) {
      const np = { id: newId("cp"), name: T("Manager.newName"), types: [{ id: newId("ct"), glyph: "star", color: "#e5322d", name: "" }] };
      draft.push(np); sel = np.id;
    } else if ( act === "dup" ) {
      const src = all().find((x) => x.id === sel), rs = src.custom ? src : resolvePreset(src);
      const np = { id: newId("cp"), name: `${presetLabel(src)} ${T("Manager.copy")}`, types: rs.types.map((t) => ({ id: newId("ct"), glyph: t.glyph, color: t.color, name: src.custom ? t.name : typeLabel(t) })) };
      draft.push(np); sel = np.id;
    } else if ( act === "delete" && p ) {
      const ok = await DialogV2.confirm({ window: { title: T("Manager.delete") }, content: `<p>${esc(game.i18n.format("MOINENMAPS.Manager.deleteConfirm", { name: p.name }))}</p>`, rejectClose: false });
      if ( !ok ) return;
      draft.splice(draft.indexOf(p), 1); sel = DEFAULT_PRESET;
    } else if ( act === "add" && p ) {
      p.types.push({ id: newId("ct"), glyph: "star", color: "#e5322d", name: "" });
    } else if ( p && i >= 0 && act === "del" ) {
      p.types.splice(i, 1);
    } else if ( p && i >= 0 && act === "up" && i > 0 ) {
      [p.types[i - 1], p.types[i]] = [p.types[i], p.types[i - 1]];
    } else if ( p && i >= 0 && act === "down" && i < p.types.length - 1 ) {
      [p.types[i + 1], p.types[i]] = [p.types[i], p.types[i + 1]];
    } else return;
    dirty = true;
    render();
  };
  const onChange = (ev) => { if ( ev.target.name === "preset" ) { sel = ev.target.value; render(); } else onInput(ev); };
  // Enter in a text field must not submit anything around the panel
  const onKey = (ev) => { if ( ev.key === "Enter" && ev.target.matches("input") ) ev.preventDefault(); };
  host.addEventListener("input", onInput);
  host.addEventListener("change", onChange);
  host.addEventListener("click", onClick);
  host.addEventListener("keydown", onKey);
  manager = {
    select: (id) => { if ( all().some((x) => x.id === id) ) { sel = id; render(); } },
    // presets were saved (here or by another GM): follow them unless this draft holds unsaved edits
    reload: () => { if ( !dirty ) { draft = load(); render(); } }
  };
  render();
  return () => {
    manager = null;
    host.removeEventListener("input", onInput); host.removeEventListener("change", onChange);
    host.removeEventListener("click", onClick); host.removeEventListener("keydown", onKey);
  };
}

/** Point the docked manager at a preset (the palette's "manage" button). */
export const managerSelect = (id) => manager?.select(id);

