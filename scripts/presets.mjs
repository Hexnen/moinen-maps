import { MODULE_ID, GLYPHS, DEFAULT_PRESET, allPresets, customPresets, resolvePreset, findPinType, typeLabel, presetLabel, resetPresetCache } from "./config.mjs";
import { compositePin } from "./pin-art.mjs";
import { refreshPins } from "./pin.mjs";
import { fg, fitDialog } from "./labels.mjs";

/**
 * Pin presets: the palette (a popover next to the toolbar holding one preset's pins) and the preset manager (create / edit / delete
 * custom presets). The preset data and lookups live in config.mjs; this file is the UI and the remembered selection.
 */

const TOOL = "mm-pin";
const T = (k) => game.i18n.localize(`MOINENMAPS.${k}`);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const get = (k) => { try { return game.settings.get(MODULE_ID, k); } catch { return ""; } };

export function registerPresetSettings() {
  const S = game.settings;
  S.register(MODULE_ID, "pinPresets", {
    scope: "world", config: false, type: Array, default: [],
    onChange: () => { resetPresetCache(); if ( canvas?.ready ) refreshPins(); renderPalette(); refreshToolButton(); }
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
  const b = ui.controls?.element?.querySelector(`button.tool[data-tool="${TOOL}"]`);
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

let palette = null, anchorEl = null, detach = null;
export const paletteOpen = () => !!palette;

export function togglePalette(anchor) { palette ? closePalette() : openPalette(anchor); }

export function closePalette() {
  detach?.(); detach = null;
  palette?.remove(); palette = null;
}

function openPalette(anchor) {
  closePalette();
  anchorEl = anchor ?? ui.controls?.element?.querySelector('button.tool[data-tool="mm-palette"]');
  const el = palette = document.createElement("div");
  el.id = "mm-palette"; el.className = "mm-palette"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", T("Palette.title"));
  document.body.append(el);
  renderPalette();
  const onDown = (ev) => { if ( !el.contains(ev.target) && !anchorEl?.contains(ev.target) ) closePalette(); };
  const onKey = (ev) => { if ( ev.key === "Escape" ) { ev.preventDefault(); ev.stopPropagation(); closePalette(); } };
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey, true);
  detach = () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey, true); };
  el.querySelector(".mm-pal-type.on, .mm-pal-type")?.focus();
}

function placePalette() {
  if ( !palette ) return;
  const r = anchorEl?.getBoundingClientRect?.();
  const w = palette.offsetWidth, h = palette.offsetHeight, m = 8;
  const left = r ? r.right + m : m, top = r ? r.top : m;
  palette.style.left = `${Math.max(m, Math.min(left, innerWidth - w - m))}px`;
  palette.style.top = `${Math.max(m, Math.min(top, innerHeight - h - m))}px`;
}

function renderPalette() {
  if ( !palette ) return;
  const cur = currentPinType(), preset = currentPreset();
  const opts = allPresets().map((p) => `<option value="${esc(p.id)}"${p.id === preset.id ? " selected" : ""}>${esc(presetLabel(p))}</option>`).join("");
  const types = preset.types.map((t) => `<button type="button" class="mm-pal-type${t.id === cur.id ? " on" : ""}" data-id="${esc(t.id)}" aria-pressed="${t.id === cur.id}" style="--c:${t.color}">
      <img src="${thumb(t.glyph, t.color)}" alt="" inert><span>${esc(typeLabel(t))}</span></button>`).join("");
  palette.innerHTML = `<div class="mm-pal-head">
      <select name="preset" aria-label="${esc(T("Palette.preset"))}">${opts}</select>
      <button type="button" class="mm-pal-manage" data-act="manage" aria-label="${esc(T("Palette.manage"))}" data-tooltip="${esc(T("Palette.manage"))}"><i class="fa-solid fa-sliders" inert></i></button>
    </div>
    <div class="mm-pal-grid" role="group" aria-label="${esc(presetLabel(preset))}">${types || `<p class="hint">${esc(T("Palette.empty"))}</p>`}</div>`;
  palette.querySelector('[name="preset"]').addEventListener("change", (ev) => {
    const p = allPresets().find((x) => x.id === ev.target.value);
    game.settings.set(MODULE_ID, "pinPreset", ev.target.value).then(() => game.settings.set(MODULE_ID, "pinType", p?.types[0]?.id ?? ""));
  });
  palette.querySelector('[data-act="manage"]').addEventListener("click", () => { closePalette(); openPresetManager(preset.id); });
  palette.querySelectorAll(".mm-pal-type").forEach((b) => b.addEventListener("click", () => {
    selectType(b.dataset.id);
    ui.controls.activate({ tool: TOOL });
    closePalette();
  }));
  placePalette();
}

/* ---------------------------------------------------------------------------------------------- */
/*  Preset manager                                                                                 */
/* ---------------------------------------------------------------------------------------------- */

const newId = (prefix) => `${prefix}-${foundry.utils.randomID(8)}`;
const glyphLabel = (g) => T(`Glyph.${g}`);

/** Create, edit, duplicate and delete custom presets. Built-in presets are shown read-only and can be duplicated. */
export async function openPresetManager(startId) {
  const DialogV2 = foundry.applications.api.DialogV2;
  const draft = customPresets().map((p) => ({ id: p.id, name: p.name, types: p.types.map((t) => ({ ...t })) }));
  const all = () => [...allPresets().filter((p) => !p.custom), ...draft.map((p) => ({ ...p, custom: true }))];
  let sel = all().some((p) => p.id === startId) ? startId : currentPreset().id;
  let root = null;

  const rowHtml = (t, i, n) => `<div class="mm-pm-row" data-i="${i}">
      <img class="mm-pm-thumb" src="${thumb(t.glyph, t.color)}" alt="" inert>
      <input type="text" name="name" value="${esc(t.name)}" placeholder="${esc(glyphLabel(t.glyph))}" aria-label="${esc(T("Manager.pinName"))}">
      <select name="glyph" aria-label="${esc(T("Manager.glyph"))}">${Object.keys(GLYPHS).map((g) => `<option value="${g}"${g === t.glyph ? " selected" : ""}>${esc(glyphLabel(g))}</option>`).join("")}</select>
      <color-picker name="color" value="${esc(t.color)}"></color-picker>
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
         <button type="button" data-act="add"><i class="fa-solid fa-plus" inert></i> ${esc(T("Manager.add"))}</button>`
      : `<p class="hint">${esc(T("Manager.builtinHint"))}</p><div class="mm-pm-list">${resolvePreset(p).types.map(roHtml).join("")}</div>`;
    root.innerHTML = `<div class="mm-pm-bar">
        <select name="preset" aria-label="${esc(T("Palette.preset"))}">${presets.map((x) => `<option value="${esc(x.id)}"${x.id === sel ? " selected" : ""}>${esc(presetLabel(x))}${x.custom ? "" : ` · ${esc(T("Manager.builtin"))}`}</option>`).join("")}</select>
        <button type="button" data-act="new" data-tooltip="${esc(T("Manager.new"))}" aria-label="${esc(T("Manager.new"))}"><i class="fa-solid fa-file-circle-plus" inert></i></button>
        <button type="button" data-act="dup" data-tooltip="${esc(T("Manager.duplicate"))}" aria-label="${esc(T("Manager.duplicate"))}"><i class="fa-solid fa-clone" inert></i></button>
        <button type="button" class="mm-danger" data-act="delete" ${p.custom ? "" : "disabled"} data-tooltip="${esc(T("Manager.delete"))}" aria-label="${esc(T("Manager.delete"))}"><i class="fa-solid fa-trash" inert></i></button>
      </div><div class="mm-pm-body">${body}</div>`;
  };
  const cur = () => draft.find((x) => x.id === sel);

  const onInput = (ev) => {
    const p = cur(); if ( !p ) return;
    const t = ev.target;
    if ( t.name === "pname" ) { p.name = t.value; return; }
    const row = t.closest(".mm-pm-row"); if ( !row ) return;
    const type = p.types[Number(row.dataset.i)]; if ( !type ) return;
    if ( t.name === "name" ) type.name = t.value;
    else if ( t.name === "glyph" ) type.glyph = t.value;
    else if ( t.name === "color" ) type.color = t.value;
    else return;
    row.querySelector(".mm-pm-thumb").src = thumb(type.glyph, type.color);
    if ( t.name === "glyph" ) row.querySelector('[name="name"]').placeholder = glyphLabel(type.glyph);
  };

  const onClick = async (ev) => {
    const b = ev.target.closest("[data-act]"); if ( !b || b.disabled ) return;
    const act = b.dataset.act, p = cur(), row = b.closest(".mm-pm-row"), i = row ? Number(row.dataset.i) : -1;
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
    render();
  };

  const clean = () => draft.map((p) => ({
    id: p.id, name: p.name.trim() || T("Manager.newName"),
    types: p.types.map((t) => ({ id: t.id, glyph: t.glyph, color: t.color, name: t.name.trim() || glyphLabel(t.glyph) }))
  }));

  await DialogV2.prompt({
    window: { title: T("Manager.title"), icon: "fa-solid fa-layer-group" },
    classes: ["moinen-maps-dialog", "mm-pm"],
    position: { width: 600 },
    content: `<div class="mm-pm-root"></div>`,
    render: (_ev, dlg) => {
      const el = dlg.element; root = el.querySelector(".mm-pm-root");
      render(); fitDialog(dlg);
      root.addEventListener("input", onInput);
      root.addEventListener("change", (ev) => {
        if ( ev.target.name === "preset" ) { sel = ev.target.value; render(); } else onInput(ev);
      });
      root.addEventListener("click", onClick);
      // Enter in a text field must not submit (and so close) the whole manager
      root.addEventListener("keydown", (ev) => { if ( ev.key === "Enter" && ev.target.matches("input") ) ev.preventDefault(); });
    },
    ok: {
      label: T("Apply"), icon: "fa-solid fa-check",
      callback: () => game.settings.set(MODULE_ID, "pinPresets", clean())
    },
    rejectClose: false
  });
}
