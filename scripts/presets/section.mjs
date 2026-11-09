import { extendSection } from "../workspace/registry.mjs";
import { esc, T, optRange, optHint, writeControl, isEcho } from "../workspace/ui.mjs";
import { MODULE_ID } from "../config.mjs";
import { sharedNow } from "../shared-clock.mjs";
import * as Core from "./core.mjs";
import * as U from "./ui-core.mjs";
import * as S from "./store.mjs";
import * as Aim from "./aim.mjs";

/**
 * DESTRUCTION PRESETS, the soundboard (P7 of dev/presets-design.md): "something like a soundboard, but for destruction - a set of
 * ready settings under one brush". Added to the Destruction workspace with extendSection (destruction/section.mjs is unchanged):
 *  - tool "Presets" (mm-d-preset): one gesture on the map fires the armed pad (aim.mjs: the ghost, the keys);
 *  - bar: the pads (icon, name, hotkey, gesture glyph), size, power (weaker / normal / stronger), variation (a new seed each firing),
 *    the aftermath (the armed preset's duration slider and "no end", back to the preset's own), and for a gun its SHOOTER (the source
 *    token its muzzle flashes at: pick one on the map, take the selected token, or none - no shooter, no muzzle flash);
 *  - dock panel "Presets" (closed until the tool is first picked): the pad grid (drag to reorder: the hotkeys follow), the armed
 *    preset (test fire, duplicate, delete), the editor of the world's own presets (name, icon, lead-in, aftermath, the layers with
 *    their switches and values, the timeline - drag a bar to move its start) and the scene's firings (take back, settle, fire again,
 *    put out the timed fires).
 * Every stored value is a setting of store.mjs; a world that never picks the tool runs nothing of this (no canvas object, listener
 * or ticker: aim.mjs builds them on the tool's activation).
 */
const TOOL = "mm-d-preset";
const INK = "#ffb347";
const api = () => game.modules.get(MODULE_ID)?.api?.presets;
const POWER = [[-1, "powerWeak", "#f2c14e"], [0, "powerNormal", "#ef8a3a"], [1, "powerStrong", "#e0453a"]];
const LAYER_ICON = { destruction: "fa-solid fa-house-crack", fire: "fa-solid fa-fire", smoke: "fa-solid fa-smog", burst: "fa-solid fa-sun", dust: "fa-solid fa-wind",
  accent: "fa-solid fa-wand-magic-sparkles", cue: "fa-solid fa-display" };
const LAYER_INK = { destruction: "#e0453a", fire: "#ff8a24", smoke: "#a8a29a", burst: "#ffd27a", dust: "#c8b48c", accent: "#9fd2ff", cue: "#dff0ff" };
const fmt = (k, data) => game.i18n.format(`MOINENMAPS.${k}`, data);
const secs = (s) => (s === null ? "∞" : s >= 60 && s % 60 === 0 ? `${s / 60} min` : `${s} s`);

/* ---------------------------------------------------------------- the bar */

function padButton(def, i, armedId) {
  const key = U.hotkeyOf(i), name = S.nameOf(def);
  const tip = `${name}${key ? ` (${key})` : ""}${S.hintOf(def) ? `: ${S.hintOf(def)}` : ""}`;
  return `<button type="button" class="mm-ws-toolbtn mm-pr-pad${S.isCustom(def) ? " is-custom" : ""}" data-pad="${esc(def.id)}" aria-pressed="${def.id === armedId}" data-tooltip="${esc(tip)}" aria-label="${esc(name)}">
    <i class="${esc(def.icon || "fa-solid fa-bomb")}" inert></i><span class="mm-pr-name">${esc(name)}</span>${key ? `<kbd inert>${esc(key)}</kbd>` : ""}<i class="mm-pr-gest ${esc(U.GESTURE_ICON[def.gesture] ?? "")}" inert></i></button>`;
}

function aftermathBlock(def, b) {
  const a = U.aftermathOf(def, b);
  if ( !a.has ) return `<div class="mm-ws-opt mm-pr-aft is-none" data-tooltip="${esc(T("DPreset.aftermathNone"))}"><span class="mm-ws-label">${esc(T("DPreset.aftermath"))}</span><span class="mm-pr-none">—</span></div>`;
  const own = def.aftermath?.dur ?? null;
  return `<div class="mm-ws-opt mm-pr-aft" data-tooltip="${esc(T("DPreset.aftermathHint"))}">
    <span class="mm-ws-label">${esc(T("DPreset.aftermath"))}</span>
    <range-picker name="aft" value="${a.dur ?? (own ?? 60)}" min="${Core.AFTERMATH.min}" max="${Core.AFTERMATH.max}" step="${Core.AFTERMATH.step}"${a.dur === null ? " disabled" : ""}></range-picker>
    <button type="button" class="mm-ws-toolbtn" data-aft-noend aria-pressed="${a.dur === null}" aria-label="${esc(T("DPreset.aftermathNoEnd"))}" data-tooltip="${esc(T("DPreset.aftermathNoEnd"))}"><i class="fa-solid fa-infinity" inert></i></button>
    <button type="button" class="mm-ws-toolbtn mm-pr-reset" data-aft-reset${a.own ? "" : " hidden"} aria-label="${esc(fmt("DPreset.aftermathReset", { dur: secs(own) }))}" data-tooltip="${esc(fmt("DPreset.aftermathReset", { dur: secs(own) }))}"><i class="fa-solid fa-rotate-left" inert></i></button></div>`;
}

/** A gun's shooter: the chosen token (its picture and name) or none; choose on the map, take the selected token, clear. */
function srcBlock(def) {
  if ( !U.isFirearm(def) ) return "";
  const t = S.srcToken(def), pick = Aim.isPicking();
  const face = t ? `<img src="${esc(t.document.texture?.src ?? "")}" alt="" inert><span class="mm-pr-srcname">${esc(t.name || t.document.name || "")}</span>`
    : `<i class="fa-solid fa-crosshairs" inert></i><span class="mm-pr-srcname">${esc(T(pick ? "DPreset.srcPicking" : "DPreset.srcNone"))}</span>`;
  return `<div class="mm-ws-opt mm-pr-src${t ? " has-src" : ""}">
    <span class="mm-ws-label" data-tooltip="${esc(T("DPreset.srcHint"))}">${esc(T("DPreset.src"))}</span>
    <button type="button" class="mm-ws-toolbtn mm-pr-srcpick" data-src-pick aria-pressed="${pick}" aria-label="${esc(T("DPreset.srcPick"))}" data-tooltip="${esc(T(pick ? "DPreset.srcPickingHint" : "DPreset.srcPick"))}">${pick && t ? `<i class="fa-solid fa-crosshairs" inert></i><span class="mm-pr-srcname">${esc(T("DPreset.srcPicking"))}</span>` : face}</button>
    <button type="button" class="mm-ws-toolbtn" data-src-sel aria-label="${esc(T("DPreset.srcSelected"))}" data-tooltip="${esc(T("DPreset.srcSelected"))}"><i class="fa-solid fa-user-check" inert></i></button>
    <button type="button" class="mm-ws-toolbtn" data-src-clear${t ? "" : " hidden"} aria-label="${esc(T("DPreset.srcClear"))}" data-tooltip="${esc(T("DPreset.srcClear"))}"><i class="fa-solid fa-xmark" inert></i></button></div>`;
}

function bar(host, ctx) {
  const render = () => {
    const b = S.bar(), list = S.pads(), def = S.armed();
    const pads = list.map((d, i) => padButton(d, i, def?.id)).join("");
    const power = POWER.map(([v, k, ink]) => `<button type="button" class="mm-ws-toolbtn mm-d-level" data-power="${v}" aria-pressed="${v === b.power}" style="--mm-tool:${ink}" data-tooltip="${esc(T(`DPreset.${k}Hint`))}"><span class="mm-d-dot" inert></span><span>${esc(T(`DPreset.${k}`))}</span></button>`).join("");
    host.innerHTML = `<div class="mm-ws-opt mm-pr-padsopt"><span class="mm-ws-label">${esc(T("DPreset.pads"))}</span><div class="mm-ws-tools mm-pr-pads" role="group" aria-label="${esc(T("DPreset.pads"))}">${pads}</div></div>
      ${optRange({ name: "size", label: T("DPreset.size"), value: b.size, min: U.SIZE.min, max: U.SIZE.max, step: U.SIZE.step, hint: T("DPreset.sizeHint") })}
      <div class="mm-ws-opt"><span class="mm-ws-label">${esc(T("DPreset.power"))}</span><div class="mm-ws-tools mm-d-levels" role="group" aria-label="${esc(T("DPreset.power"))}">${power}</div></div>
      <button type="button" class="mm-ws-toolbtn mm-pr-vary" data-vary aria-pressed="${b.vary}" aria-label="${esc(T("DPreset.vary"))}" data-tooltip="${esc(T("DPreset.varyHint"))}"><i class="fa-solid fa-dice" inert></i></button>
      ${def ? srcBlock(def) : ""}
      ${def ? aftermathBlock(def, b) : ""}
      ${optHint(def?.gesture === "shot" ? T("DPreset.barHintShot") : T(U.isFirearm(def) ? "DPreset.barHintGun" : "DPreset.barHint"))}`;
  };
  // the shooter's block alone (a choice, the picking state, its token changed or gone)
  const renderSrc = () => {
    const el = host.querySelector(".mm-pr-src"), def = S.armed(), html = def ? srcBlock(def) : "";
    if ( el && html ) el.outerHTML = html; else if ( !!el !== !!html ) render();
  };
  render();
  const onClick = (ev) => {
    const b = S.bar();
    const pad = ev.target.closest("[data-pad]"), pw = ev.target.closest("[data-power]"), def = S.armed();
    if ( pad && pad.dataset.pad !== b.pad ) S.setBar({ pad: pad.dataset.pad });
    else if ( pw && Number(pw.dataset.power) !== b.power ) S.setBar({ power: Number(pw.dataset.power) });
    else if ( ev.target.closest("[data-vary]") ) S.setBar({ vary: !b.vary });
    else if ( def && ev.target.closest("[data-src-pick]") ) Aim.setPicking(!Aim.isPicking());
    else if ( def && ev.target.closest("[data-src-clear]") ) { Aim.setPicking(false); S.setSrc(def, null); }
    else if ( def && ev.target.closest("[data-src-sel]") ) {
      const t = canvas.tokens?.controlled?.at(-1);
      Aim.setPicking(false);
      if ( t ) S.setSrc(def, t.id); else ui.notifications?.info(T("DPreset.srcNoSelected"));
    }
    else if ( def && ev.target.closest("[data-aft-noend]") ) {
      const a = U.aftermathOf(def, b);
      S.setBar({ aft: { ...b.aft, [def.id]: a.dur === null ? (def.aftermath?.dur ?? 60) : null } });
    } else if ( def && ev.target.closest("[data-aft-reset]") ) { const aft = { ...b.aft }; delete aft[def.id]; S.setBar({ aft }); }
    ev.target.closest("button")?.blur();
  };
  const onChange = (ev) => {
    if ( isEcho() ) return;
    const c = ev.target.closest?.("[name]"); if ( !c ) return;
    const b = S.bar(), def = S.armed();
    if ( c.name === "size" ) { const v = Math.min(U.SIZE.max, Math.max(U.SIZE.min, Number(c.value) || 1)); if ( v !== b.size ) S.setBar({ size: v }); }
    if ( c.name === "aft" && def ) S.setBar({ aft: { ...b.aft, [def.id]: Math.min(Core.AFTERMATH.max, Math.max(Core.AFTERMATH.min, Number(c.value) || 60)) } });
  };
  host.addEventListener("click", onClick); host.addEventListener("change", onChange);
  // a change elsewhere (keys, the panel, another tab): another pad re-draws the bar; else the controls are written without echo
  const id = Hooks.on(S.HOOK, (what) => {
    if ( what === "store" ) return render();
    if ( what === "picking" ) return renderSrc();
    if ( what !== "bar" ) return;
    const b = S.bar(), def = S.armed();
    if ( host.querySelector("[data-pad][aria-pressed=true]")?.dataset.pad !== def?.id ) return render();
    renderSrc();
    const s = host.querySelector("[name=size]"); if ( s && !s.contains(document.activeElement) ) writeControl(s, b.size);
    for ( const x of host.querySelectorAll("[data-power]") ) x.setAttribute("aria-pressed", String(Number(x.dataset.power) === b.power));
    host.querySelector("[data-vary]")?.setAttribute("aria-pressed", String(b.vary));
    const a = def ? U.aftermathOf(def, b) : null, r = host.querySelector(".mm-pr-aft range-picker");
    if ( a?.has && r ) {
      if ( a.dur !== null && !r.contains(document.activeElement) ) writeControl(r, a.dur);
      r.toggleAttribute("disabled", a.dur === null);
      host.querySelector("[data-aft-noend]")?.setAttribute("aria-pressed", String(a.dur === null));
      const rs = host.querySelector("[data-aft-reset]"); if ( rs ) rs.hidden = !a.own;
    }
  });
  // the panel comes up the first time the tool is picked (it stays closed for a GM who never picks it)
  if ( ctx?.tool === TOOL ) {
    if ( !revealed ) { revealed = true; ctx.revealPanel?.("presets"); }
    // the dock brought to the soundboard (it sits under the Damage, Look and Fire panels)
    requestAnimationFrame(() => document.querySelector("#moinen-maps-workspace .mm-ws-panel[data-panel='presets']")?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }
  // (the shooter's token renamed, re-imaged or deleted; another scene)
  const idT = Hooks.on("updateToken", (doc) => { if ( doc.id === S.srcToken(S.armed())?.id ) renderSrc(); });
  const idD = Hooks.on("deleteToken", () => renderSrc());
  const idC = Hooks.on("canvasReady", () => renderSrc());
  return () => {
    host.removeEventListener("click", onClick); host.removeEventListener("change", onChange);
    Hooks.off(S.HOOK, id); Hooks.off("updateToken", idT); Hooks.off("deleteToken", idD); Hooks.off("canvasReady", idC);
  };
}
let revealed = false;

/* ---------------------------------------------------------------- the dock panel */

const folds = new Set(["armed", "firings"]);
let editing = null;          // the custom preset open in the editor (its id)
let saveTimer = 0, draft = null;

function layerLabel(L) {
  if ( L.l === "accent" && L.kind ) return T(`DPreset.accent.${L.kind}`);
  if ( L.l === "cue" ) return T(`DPreset.cue.${L.kind === "light" ? "light" : "screen"}`);
  if ( L.l === "dust" ) return `${T("DPreset.layer.dust")} · ${T(`DPreset.dust.${L.dk === "hits" ? "hits" : "shock"}`)}`;
  return T(`DPreset.layer.${L.l}`);
}

function timelineHtml(def) {
  const tl = U.timelineOf(def), span = tl.to - tl.from || 1, pct = (t) => ((t - tl.from) / span) * 100;
  const rows = tl.rows.map((r) => `<div class="mm-pr-tlrow${r.off ? " is-off" : ""}" style="--mm-tool:${LAYER_INK[r.l]}"><span class="mm-pr-tlbar${r.long ? " is-long" : ""}" data-tl="${r.i}" style="left:${pct(r.start).toFixed(2)}%;width:${Math.max(1.5, pct(r.end) - pct(r.start)).toFixed(2)}%" data-tooltip="${esc(`${layerLabel(def.layers[r.i])}: ${(r.start / 1000).toFixed(2)} s`)}"></span></div>`).join("");
  return `<div class="mm-pr-tl" data-from="${tl.from}" data-to="${tl.to}" aria-label="${esc(T("DPreset.timeline"))}"><span class="mm-pr-t0" style="left:${pct(0).toFixed(2)}%" inert></span>${rows}</div>`;
}

function editorHtml(def) {
  const icons = U.ICONS.map((ic) => `<button type="button" class="mm-ws-toolbtn" data-icon="${esc(ic)}" aria-pressed="${ic === def.icon}"><i class="${esc(ic)}" inert></i></button>`).join("");
  const aft = def.aftermath;
  const layers = def.layers.map((L, i) => {
    const pending = Core.PENDING.includes(L.l);
    const fields = U.fieldsOf(L).map(([k, lo, hi, st]) => `<label class="mm-pr-field"><span>${esc(T(`DPreset.field.${k}`))}</span><range-picker name="L.${i}.${k}" value="${U.getField(L, k)}" min="${lo}" max="${hi}" step="${st}"></range-picker></label>`).join("");
    return `<li class="mm-pr-layer${L.off ? " is-off" : ""}" style="--mm-tool:${LAYER_INK[L.l]}">
      <label class="mm-pr-switch" data-tooltip="${esc(T("DPreset.layerOn"))}"><input type="checkbox" name="L.${i}.on"${L.off ? "" : " checked"}><i class="${LAYER_ICON[L.l]}" inert></i><span>${esc(layerLabel(L))}</span>${pending ? `<i class="fa-regular fa-clock mm-pr-pending" data-tooltip="${esc(T("DPreset.pendingHint"))}"></i>` : ""}</label>
      ${fields ? `<div class="mm-pr-fields">${fields}</div>` : ""}</li>`;
  }).join("");
  return `<div class="mm-pr-editor" data-edit="${esc(def.id)}">
    <div class="mm-ws-opt"><label>${esc(T("DPreset.name"))}</label><input type="text" name="E.name" value="${esc(def.name)}" maxlength="40"></div>
    <div class="mm-ws-opt mm-pr-icons"><span class="mm-ws-label">${esc(T("DPreset.icon"))}</span><div class="mm-ws-tools" role="group" aria-label="${esc(T("DPreset.icon"))}">${icons}</div></div>
    ${optRange({ name: "E.preroll", label: T("DPreset.preroll"), value: def.preroll ?? 0, min: 0, max: 4000, step: 50, hint: T("DPreset.prerollHint") })}
    ${aft ? `<div class="mm-ws-opt mm-pr-eaft"><label data-tooltip="${esc(T("DPreset.aftermathHint"))}">${esc(T("DPreset.aftermath"))}</label><range-picker name="E.aft" value="${aft.dur ?? 60}" min="${Core.AFTERMATH.min}" max="${Core.AFTERMATH.max}" step="${Core.AFTERMATH.step}"${aft.dur === null ? " disabled" : ""}></range-picker>
      <button type="button" class="mm-ws-toolbtn" data-e-noend aria-pressed="${aft.dur === null}" aria-label="${esc(T("DPreset.aftermathNoEnd"))}" data-tooltip="${esc(T("DPreset.aftermathNoEnd"))}"><i class="fa-solid fa-infinity" inert></i></button></div>` : ""}
    <div class="mm-pr-sub"><span>${esc(T("DPreset.timeline"))}</span><i class="fa-regular fa-circle-question" data-tooltip="${esc(T("DPreset.timelineHint"))}"></i></div>
    ${timelineHtml(def)}
    <div class="mm-pr-sub"><span>${esc(T("DPreset.layers"))}</span></div>
    <ul class="mm-pr-layers">${layers}</ul></div>`;
}

function ago(t) {
  const s = Math.max(0, Math.round((sharedNow() - t) / 1000));
  return s < 60 ? fmt("DPreset.agoS", { n: s }) : fmt("DPreset.agoM", { n: Math.round(s / 60) });
}
function firingsHtml() {
  const list = api()?.firings() ?? [], burning = api()?.fires() ?? [];
  const timed = burning.filter((f) => f.o !== null).length;
  const rows = list.slice(0, 12).map((r) => {
    const def = S.padById(r.preset);
    const name = def ? S.nameOf(def) : r.preset;
    return `<li data-firing="${esc(r.id)}"><i class="${esc(def?.icon ?? "fa-solid fa-bomb")}" inert></i>
      <span class="mm-pr-fname">${esc(name)}<small>${esc(ago(r.t0))}</small></span>
      <span class="mm-pr-state is-${esc(r.state)}">${esc(T(`DPreset.state.${r.state}`))}${r.partial ? ` · ${esc(T("DPreset.partial"))}` : ""}</span>
      <span class="mm-pr-rowacts"><button type="button" data-act="undoOne" data-id="${esc(r.id)}" aria-label="${esc(T("DPreset.undoOne"))}" data-tooltip="${esc(T("DPreset.undoOne"))}"><i class="fa-solid fa-rotate-left" inert></i></button>
      <button type="button" data-act="settle" data-id="${esc(r.id)}" aria-label="${esc(T("DPreset.settle"))}" data-tooltip="${esc(T("DPreset.settleHint"))}"><i class="fa-solid fa-thumbtack" inert></i></button></span></li>`;
  }).join("");
  return `${rows ? `<ul class="mm-d-areas mm-pr-firings" aria-label="${esc(T("DPreset.firings"))}">${rows}</ul>` : `<p class="mm-d-status">${esc(T("DPreset.firingsEmpty"))}</p>`}
    <div class="mm-d-actions">
      <button type="button" class="mm-ws-btn" data-act="undoLast"${list.length ? "" : " disabled"}><i class="fa-solid fa-rotate-left" inert></i> ${esc(T("DPreset.undoLast"))}</button>
      <button type="button" class="mm-ws-btn" data-act="redo" disabled><i class="fa-solid fa-rotate-right" inert></i> ${esc(T("DPreset.redo"))}</button>
      <button type="button" class="mm-ws-btn" data-act="clearFires"${timed ? "" : " disabled"} data-tooltip="${esc(T("DPreset.clearFiresHint"))}"><i class="fa-solid fa-fire-extinguisher" inert></i> ${esc(fmt("DPreset.clearFires", { n: timed }))}</button>
    </div>`;
}

function fold(id, title, icon, body, head = "") {
  return `<details class="mm-fold mm-ws-group" data-fold="${id}"${folds.has(id) ? " open" : ""}><summary>${head}<i class="${icon}" inert></i><span>${esc(title)}</span></summary><div class="mm-fold-body">${body}</div></details>`;
}

function mountPanel(host) {
  const render = () => {
    const list = S.pads(), def = S.armed();
    if ( editing && !(S.isCustom(S.padById(editing))) ) editing = null;
    const tiles = list.map((d, i) => `<button type="button" class="mm-pr-tile${S.isCustom(d) ? " is-custom" : ""}" draggable="true" data-pad="${esc(d.id)}" aria-pressed="${d.id === def?.id}" data-tooltip="${esc(S.hintOf(d) || S.nameOf(d))}">
      <i class="${esc(d.icon || "fa-solid fa-bomb")}" inert></i><span inert>${esc(S.nameOf(d))}</span>${U.hotkeyOf(i) ? `<kbd inert>${esc(U.hotkeyOf(i))}</kbd>` : ""}<i class="mm-pr-gest ${esc(U.GESTURE_ICON[d.gesture] ?? "")}" inert></i></button>`).join("");
    const custom = S.isCustom(def);
    const armedBody = def ? `<p class="mm-pr-hint">${esc(S.hintOf(def) || T("DPreset.customHint"))}</p>
      <p class="mm-d-status">${esc(custom ? T("DPreset.custom") : T("DPreset.builtin"))}</p>
      <div class="mm-d-actions">
        <button type="button" class="mm-ws-btn" data-act="test" data-tooltip="${esc(T("DPreset.testFireHint"))}"><i class="fa-solid fa-play" inert></i> ${esc(T("DPreset.testFire"))}</button>
        <button type="button" class="mm-ws-btn" data-act="duplicate" data-tooltip="${esc(T("DPreset.duplicateHint"))}"><i class="fa-solid fa-clone" inert></i> ${esc(T("DPreset.duplicate"))}</button>
        ${custom ? `<button type="button" class="mm-ws-btn" data-act="edit" aria-pressed="${editing === def.id}"><i class="fa-solid fa-pen" inert></i> ${esc(T("DPreset.edit"))}</button>
          <button type="button" class="mm-ws-btn mm-danger" data-act="delete"><i class="fa-solid fa-trash" inert></i> ${esc(T("DPreset.delete"))}</button>` : ""}
      </div>${custom && editing === def.id ? editorHtml(draft?.id === def.id ? draft : def) : ""}` : "";
    host.innerHTML = `<div class="mm-ws-form mm-pr-panel">
      <div class="mm-pr-grid" role="group" aria-label="${esc(T("DPreset.pads"))}">${tiles}</div>
      <p class="mm-ws-hint mm-pr-gridhint">${esc(T("DPreset.gridHint"))}</p>
      ${def ? fold("armed", S.nameOf(def), def.icon || "fa-solid fa-bomb", armedBody) : ""}
      ${fold("firings", T("DPreset.firings"), "fa-solid fa-list-ul", `<div class="mm-pr-firewrap">${firingsHtml()}</div>`)}</div>`;
    redoState();
  };
  // "Fire again" only while there is a firing taken back (the GM's redo stack, once the writer is loaded)
  const redoState = () => api()?._status?.().then((st) => { const b = host.querySelector("[data-act=redo]"); if ( b ) b.disabled = !st?.stacks?.redo?.length; }).catch(() => {});
  render();
  const refreshFirings = () => { const w = host.querySelector(".mm-pr-firewrap"); if ( w && !w.contains(document.activeElement) ) { w.innerHTML = firingsHtml(); redoState(); } };

  // the editor writes a draft at once (the panel shows it) and stores it a moment after the last change
  const commit = (next) => {
    draft = next;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { const d = draft; draft = null; if ( d ) S.saveCustom(d); }, 350);
  };
  const current = () => { const d = S.armed(); return draft?.id === d?.id ? draft : d; };

  const onClick = async (ev) => {
    const tile = ev.target.closest("[data-pad]");
    if ( tile ) { if ( tile.dataset.pad !== S.bar().pad ) S.setBar({ pad: tile.dataset.pad }); return; }
    const ic = ev.target.closest("[data-icon]");
    if ( ic ) { const d = current(); if ( d ) { commit({ ...d, icon: ic.dataset.icon }); render(); } return; }
    if ( ev.target.closest("[data-e-noend]") ) { const d = current(); if ( d?.aftermath ) { commit({ ...d, aftermath: { dur: d.aftermath.dur === null ? 60 : null } }); render(); } return; }
    const b = ev.target.closest("[data-act]"); if ( !b ) return;
    b.blur();
    const def = S.armed(), P = api();
    switch ( b.dataset.act ) {
      case "test": if ( def && !Aim.dryRun(current()) ) ui.notifications.warn(T("DPreset.testFail")); break;
      case "duplicate": {
        if ( !def ) break;
        const ids = S.pads().map((d) => d.id), copy = U.duplicate(current(), fmt("DPreset.copyName", { name: S.nameOf(def) }).slice(0, 40), ids);
        const s = S.store(), order = S.pads().map((d) => d.id), at = order.indexOf(def.id);
        order.splice(at + 1, 0, copy.id);
        await S.setStore({ ...s, custom: [...s.custom, copy], order });
        editing = copy.id; folds.add("armed");
        await S.setBar({ pad: copy.id });
        break;
      }
      case "edit": editing = editing === def?.id ? null : def?.id ?? null; render(); break;
      case "delete": {
        const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: T("DPreset.delete") }, content: `<p>${esc(fmt("DPreset.deleteConfirm", { name: S.nameOf(def) }))}</p>`, rejectClose: false, modal: true });
        if ( ok ) { editing = null; await S.deleteCustom(def.id); }
        break;
      }
      case "undoOne": await P?.undo(b.dataset.id); refreshFirings(); break;
      case "settle": await P?.settle(b.dataset.id); refreshFirings(); break;
      case "undoLast": await P?.undo(); refreshFirings(); break;
      case "redo": await P?.redo(); refreshFirings(); break;
      case "clearFires": await P?.clearFires(); refreshFirings(); break;
    }
  };
  const onChange = (ev) => {
    if ( isEcho() ) return;
    const c = ev.target.closest?.("[name]"); if ( !c ) return;
    const d = current(); if ( !d || !S.isCustom(d) ) return;
    const m = /^L\.(\d+)\.(\w+)$/.exec(c.name);
    if ( m ) {
      const i = Number(m[1]), layers = d.layers.slice();
      layers[i] = m[2] === "on" ? { ...layers[i], off: !c.checked } : U.setField(layers[i], m[2], Number(c.value));
      if ( m[2] === "on" ) { const li = c.closest(".mm-pr-layer"); li?.classList.toggle("is-off", !c.checked); }
      commit({ ...d, layers });
      const tl = host.querySelector(".mm-pr-tl"); if ( tl ) tl.outerHTML = timelineHtml(draft);
      return;
    }
    if ( c.name === "E.name" ) commit({ ...d, name: String(c.value).trim().slice(0, 40) || d.id });
    if ( c.name === "E.preroll" ) { commit({ ...d, preroll: Math.round(Number(c.value) || 0) }); const tl = host.querySelector(".mm-pr-tl"); if ( tl ) tl.outerHTML = timelineHtml(draft); }
    if ( c.name === "E.aft" && d.aftermath ) commit({ ...d, aftermath: { dur: Math.round(Number(c.value) || 60) } });
  };

  // drag the pads to reorder them (the hotkeys follow the order)
  let dragId = null;
  const onDragStart = (ev) => { const t = ev.target.closest?.(".mm-pr-tile"); if ( !t ) return; dragId = t.dataset.pad; ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", dragId); t.classList.add("is-dragging"); };
  const onDragOver = (ev) => {
    if ( !dragId ) return; const t = ev.target.closest?.(".mm-pr-tile"); if ( !t ) return;
    ev.preventDefault();
    for ( const x of host.querySelectorAll(".mm-pr-tile.is-over") ) if ( x !== t ) x.classList.remove("is-over");
    t.classList.add("is-over");
  };
  const onDrop = (ev) => {
    if ( !dragId ) return; ev.preventDefault();
    const t = ev.target.closest?.(".mm-pr-tile"), ids = S.pads().map((d) => d.id);
    const r = t?.getBoundingClientRect(), after = r ? ev.clientX > r.left + r.width / 2 : true;
    let before = t ? (after ? ids[ids.indexOf(t.dataset.pad) + 1] ?? null : t.dataset.pad) : null;
    if ( before === dragId ) before = ids[ids.indexOf(dragId) + 1] ?? null;
    const next = U.reorder(ids, dragId, before); dragId = null;
    if ( next.join() !== ids.join() ) S.setOrder(next); else render();
  };
  const onDragEnd = () => { dragId = null; for ( const x of host.querySelectorAll(".is-dragging, .is-over") ) x.classList.remove("is-dragging", "is-over"); };

  // the timeline: drag a bar to move its layer's start
  let tlDrag = null;
  const onPointerDown = (ev) => {
    const bar = ev.target.closest?.(".mm-pr-tlbar"); if ( !bar || ev.button !== 0 ) return;
    const tl = bar.closest(".mm-pr-tl"), w = tl.getBoundingClientRect().width || 1;
    tlDrag = { i: Number(bar.dataset.tl), x0: ev.clientX, msPerPx: (Number(tl.dataset.to) - Number(tl.dataset.from)) / w, bar, left0: parseFloat(bar.style.left), wPct: 100 / w };
    bar.setPointerCapture?.(ev.pointerId); bar.classList.add("is-dragging"); ev.preventDefault();
  };
  const onPointerMove = (ev) => { if ( !tlDrag ) return; tlDrag.bar.style.left = `${tlDrag.left0 + (ev.clientX - tlDrag.x0) * tlDrag.wPct}%`; };
  const onPointerUp = (ev) => {
    if ( !tlDrag ) return;
    const t = tlDrag; tlDrag = null; t.bar.classList.remove("is-dragging");
    const d = current(); if ( !d ) return;
    const dms = (ev.clientX - t.x0) * t.msPerPx;
    if ( Math.abs(dms) < 25 ) { t.bar.style.left = `${t.left0}%`; return; }
    const layers = d.layers.slice(); layers[t.i] = U.shiftAt(layers[t.i], dms);
    commit({ ...d, layers });
    const tl = host.querySelector(".mm-pr-tl"); if ( tl ) tl.outerHTML = timelineHtml(draft);
  };

  // hover a firing: its outline on the map
  const onOver = (ev) => { const li = ev.target.closest?.("[data-firing]"); if ( li ) Aim.outline(api()?.firings().find((r) => r.id === li.dataset.firing) ?? null); };
  const onOut = (ev) => { const li = ev.target.closest?.("[data-firing]"); if ( li && !li.contains(ev.relatedTarget) ) Aim.outline(null); };
  const onToggle = (ev) => { const d = ev.target; if ( d.matches?.("details[data-fold]") ) { if ( d.open ) folds.add(d.dataset.fold); else folds.delete(d.dataset.fold); } };

  const evs = [["click", onClick], ["change", onChange], ["dragstart", onDragStart], ["dragover", onDragOver], ["drop", onDrop], ["dragend", onDragEnd],
    ["pointerdown", onPointerDown], ["pointermove", onPointerMove], ["pointerup", onPointerUp], ["mouseover", onOver], ["mouseout", onOut]];
  for ( const [e, f] of evs ) host.addEventListener(e, f);
  host.addEventListener("toggle", onToggle, true);
  let lastPad = S.armed()?.id;
  const id = Hooks.on(S.HOOK, (what) => {
    if ( what === "fired" ) return refreshFirings();
    if ( what === "bar" ) { if ( S.armed()?.id === lastPad ) return; lastPad = S.armed()?.id; return render(); }
    if ( draft ) return;     // (our own edit coming back: the panel already shows it)
    if ( !host.contains(document.activeElement) || document.activeElement === document.body ) render();
  });
  const idS = Hooks.on("updateScene", (scene, changed) => {
    const f = changed?.flags?.[MODULE_ID];
    if ( scene.id === canvas?.scene?.id && f && ("presetFirings" in f || "-=presetFirings" in f || "fireStrokes" in f) ) refreshFirings();
  });
  const idC = Hooks.on("canvasReady", () => render());
  const tick = setInterval(() => { if ( folds.has("firings") ) refreshFirings(); }, 2000);
  return () => {
    for ( const [e, f] of evs ) host.removeEventListener(e, f);
    host.removeEventListener("toggle", onToggle, true);
    Hooks.off(S.HOOK, id); Hooks.off("updateScene", idS); Hooks.off("canvasReady", idC); clearInterval(tick);
    Aim.outline(null);
    if ( draft ) { clearTimeout(saveTimer); const d = draft; draft = null; S.saveCustom(d); }
  };
}

/* ---------------------------------------------------------------- wiring */

const OFF = (() => { try { return globalThis.localStorage?.getItem("mm-destruction") === "off"; } catch { return false; } })();

if ( !OFF ) {
  Hooks.once("init", () => {
    S.registerPresetUiSettings();
    extendSection("destruction", {
      tools: () => [{ name: TOOL, order: 7, title: "MOINENMAPS.DPreset.tool", icon: "fa-solid fa-table-cells-large", color: INK }],
      bars: { [TOOL]: bar },
      onToolChange: (tool, active) => { if ( tool === TOOL ) Aim.setActive(active); },
      panels: [{ id: "presets", title: "MOINENMAPS.DPreset.panel", icon: "fa-solid fa-table-cells-large", open: false, mount: mountPanel }]
    });
  });
  Hooks.on("canvasReady", () => Aim.onCanvasReady());
  Hooks.on("canvasTearDown", () => Aim.onTearDown());
}
