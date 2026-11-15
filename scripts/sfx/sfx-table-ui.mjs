/* GMALLMAPS: the window of the map lettering's table options ("Comic sound effects on the map"). One place for every option of what the
   table sees of the map's sound words (sfx-prefs.mjs TABLE): which sounds, the words, the layer, the size per group. The GM edits and saves
   them for everyone (world settings; every seat follows at once); a player opens the same window and reads the GM's choices. The look
   and motion of the lettering itself (shared by every module that letters) is the engine's own table window: one button opens it, nothing
   of it is repeated here. Under the table's rows, what only this screen decides: its performance mode and its reduced motion.
   Opened from the module's settings (menu "sfxTable") and api.sfx.open(). Same visual family as the engine's window (its tokens). */
import { MODULE_ID } from "../config.mjs";
import * as PF from "./sfx-prefs.mjs";
import { SIZE_GROUPS, SIZE_SETTING } from "./sfx-size.mjs";

const { ApplicationV2 } = foundry.applications.api;
const T = (k) => game.i18n.localize(`MOINENMAPS.Sfx.${k}`);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const get = (k) => { try { return PF.clean(k, game.settings.get(MODULE_ID, k)); } catch { return PF.TABLE[k]?.def; } };
const isGM = () => !!game.user?.isGM;
const GROUPS = [["letters", ["sfxLetters", "sfxWordsWorld", "sfxLayer"]], ["size", SIZE_GROUPS.map((g) => SIZE_SETTING[g])]];
const SIZE_OF = Object.fromEntries(SIZE_GROUPS.map((g) => [SIZE_SETTING[g], g]));
const choiceLabel = (k, c) => (k === "sfxLetters" ? T(c) : k === "sfxLayer" ? T(`layers.${c}`) : T(`words${c === "auto" ? "Auto" : c === "en" ? "En" : "Pl"}`));
const stepText = (v) => T(`size.step${v}`);
const valueText = (k, v) => (SIZE_OF[k] ? stepText(v) : choiceLabel(k, v));

let deps = { table: () => null, perf: () => "high", reduced: () => false, engineMenu: async () => false };
/** sfx.mjs hands in what the window shows of this seat (no import back into the runtime) */
export function wire(d) { deps = { ...deps, ...d }; }

class TableWindow extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "moinen-maps-sfx-table", tag: "form", classes: ["mm-sfxt"],
    window: { title: 'MOINENMAPS.Sfx.table.title', icon: "fa-solid fa-burst", contentClasses: ["standard-form"] },
    position: { width: 560, height: "auto" },
    form: { handler: TableWindow.#save, submitOnChange: false, closeOnSubmit: false },
    actions: { reset: TableWindow.#reset, engine: TableWindow.#engine }
  };
  constructor() { super(); this.v = null; this.dirty = false; }
  current() { return Object.fromEntries(PF.TABLE_KEYS.map((k) => [k, get(k)])); }
  async _renderHTML() {
    const gm = isGM(), v = this.v ?? this.current(), f = foundry.applications.fields;
    const id = (k) => `mm-sfxt-${k}`;
    const row = (k) => {
      let input;
      if ( !gm ) input = `<output class="mm-sfxt-ro" id="${id(k)}">${esc(valueText(k, v[k]))}</output>`;
      else if ( SIZE_OF[k] ) input = `<span class="mm-sfxt-slide"><input type="range" id="${id(k)}" name="${k}" min="0" max="3" step="1" value="${v[k]}" data-dtype="Number">`
        + `<output for="${id(k)}">${esc(stepText(v[k]))}</output></span>`;
      else { const s = f.createSelectInput({ name: k, value: v[k], options: PF.TABLE[k].choices.map((c) => ({ value: c, label: choiceLabel(k, c) })) }); s.id = id(k); input = s.outerHTML; }
      const hint = SIZE_OF[k] ? "" : `<p class="hint">${esc(T(`table.hint.${k}`))}</p>`;
      return `<div class="form-group mm-sfxt-row" data-key="${k}"><label for="${id(k)}">${esc(T(`table.short.${k}`))}</label><div class="form-fields">${input}</div>${hint}</div>`;
    };
    const perf = deps.perf() ?? "high", red = !!deps.reduced();
    const seatLine = (on, name, text) => `<li class="${on ? "is-on" : ""}"><i class="fa-solid ${on ? "fa-circle-check" : "fa-circle"}" aria-hidden="true"></i><span><b>${esc(name)}</b> ${esc(text)}</span></li>`;
    const root = document.createElement("div");
    root.className = `mm-sfxt-body${gm ? " is-gm" : " is-player"}${v.sfxLetters === "off" ? " is-off" : ""}`;
    root.innerHTML = `
      <p class="mm-sfxt-banner"><i class="fa-solid ${gm ? "fa-users" : "fa-lock"}" aria-hidden="true"></i><span>${esc(T(gm ? "table.banner.gm" : "table.banner.player"))}</span></p>
      ${GROUPS.map(([g, keys]) => `<fieldset data-group="${g}"><legend>${esc(T(`table.group.${g}`))}</legend>${keys.map(row).join("")}`
        + `${g === "size" ? `<p class="hint mm-sfxt-foot">${esc(T("table.hint.size"))}</p>` : ""}</fieldset>`).join("")}
      <section class="mm-sfxt-seat" aria-label="${esc(T("table.seat.title"))}"><h4>${esc(T("table.seat.title"))}</h4><ul>
        ${seatLine(perf !== "high", T("table.seat.perf"), T(`table.seat.perf_${perf}`))}
        ${seatLine(red, T("table.seat.reduced"), T(red ? "table.seat.reducedOn" : "table.seat.reducedOff"))}</ul></section>
      <footer class="form-footer">
        <button type="button" data-action="engine" data-tooltip="${esc(T("table.engineHint"))}"><i class="fa-solid fa-pen-nib"></i> ${esc(T("table.engine"))}</button>
        ${gm ? `<button type="button" data-action="reset" data-tooltip="${esc(T("table.resetHint"))}"><i class="fa-solid fa-arrow-rotate-left"></i> ${esc(T("table.reset"))}</button>
        <button type="submit" class="mm-sfxt-save"><i class="fa-solid fa-floppy-disk"></i> ${esc(T("table.save"))}</button>` : ""}
      </footer>`;
    return root;
  }
  _replaceHTML(result, content) { content.replaceChildren(result); }
  _onRender() {
    win = this;
    const el = this.element;
    const mark = () => { this.dirty = true; el.querySelector(".mm-sfxt-save")?.classList.add("is-dirty"); };
    el.addEventListener("input", (e) => {
      mark();
      const t = e.target; if ( t?.type !== "range" ) return;
      const o = t.parentElement?.querySelector("output"); if ( o ) o.textContent = stepText(Number(t.value));
    });
    el.addEventListener("change", (e) => { mark(); if ( e.target?.name === "sfxLetters" ) el.querySelector(".mm-sfxt-body")?.classList.toggle("is-off", e.target.value === "off"); });
  }
  _onClose() { if ( win === this ) win = null; }
  /** the table changed (this GM saved, another GM, a macro, a reset): show it - unless this GM is editing */
  follow() { if ( isGM() && this.dirty ) return; this.v = null; this.render(); }
  values() {
    const fd = new foundry.applications.ux.FormDataExtended(this.element).object, o = {};
    for ( const k of PF.TABLE_KEYS ) if ( k in fd ) o[k] = PF.clean(k, SIZE_OF[k] ? Number(fd[k]) : fd[k]);
    return o;
  }
  static async #save() {
    if ( !isGM() ) return;
    const next = this.values();
    this.dirty = false; this.v = null;
    for ( const [k, val] of Object.entries(next) ) if ( val !== get(k) ) await game.settings.set(MODULE_ID, k, val);
    ui.notifications?.info(T("table.saved"));
    this.render();
  }
  static #reset() { if ( !isGM() ) return; this.v = Object.fromEntries(PF.TABLE_KEYS.map((k) => [k, PF.TABLE[k].def])); this.dirty = true; this.render(); }
  static async #engine() { if ( !(await deps.engineMenu()) ) ui.notifications?.warn(T("table.noEngine")); }
}

let win = null;
/** open (or bring forward) the window */
export function open() {
  if ( win?.rendered ) { win.bringToFront(); return win; }
  win = new TableWindow(); win.render({ force: true });
  return win;
}
/** a table value changed on this seat (onChange / deleteSetting): an open window shows it */
export function follow() { try { if ( win?.rendered ) win.follow(); } catch {} }
/** the settings menu entry: its button opens the window (players too: they read the table) */
export class TableMenu extends ApplicationV2 { render() { open(); return this; } }
