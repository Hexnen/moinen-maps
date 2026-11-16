/* GMALLMAPS: the window of the map lettering's table options ("Comic sound effects on the map"). One place for every option of what the
   table sees of the map's sound words (sfx-prefs.mjs TABLE): which sounds, the words, the layer, the size per group. The GM edits and saves
   them for everyone (world settings; every seat follows at once); a player opens the same window and reads the GM's choices. The look
   and motion of the lettering itself (shared by every module that letters) is the engine's own table window: one button opens it, nothing
   of it is repeated here. Under the table's rows, what only this screen decides: its performance mode and its reduced motion.
   MAPWIN (ADVM 11): the window says what the table holds and what is only in the form. A status line over the buttons names the unsaved
   rows ("Not saved: 2 changes. The table still sees the old values."), each changed row shows the table's value next to the edited one,
   "Save for the table" works only while something differs, "Discard" puts the table's values back, "Defaults" fills the form and is off
   when the form already holds them. The word set has two choices (English / Polish); "Defaults" names it from the GM's language.
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
const choiceLabel = (k, c) => (k === "sfxLetters" ? T(c) : k === "sfxLayer" ? T(`layers.${c}`) : T(`words${c === "en" ? "En" : "Pl"}`));
const choicesOf = (k) => (k === "sfxWordsWorld" ? PF.WORD_SETS : PF.TABLE[k].choices);
const F = (k, data) => T(k).replace(/\{(\w+)\}/g, (m, n) => (n in data ? data[n] : m));
const stepText = (v) => T(`size.step${v}`);
const valueText = (k, v) => (SIZE_OF[k] ? stepText(v) : choiceLabel(k, v));

let deps = { table: () => null, guiLang: () => "en", perf: () => "high", reduced: () => false, engineMenu: async () => false };
/** sfx.mjs hands in what the window shows of this seat (no import back into the runtime) */
export function wire(d) { deps = { ...deps, ...d }; }

class TableWindow extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "moinen-maps-sfx-table", tag: "form", classes: ["mm-sfxt"],
    window: { title: 'MOINENMAPS.Sfx.table.title', icon: "fa-solid fa-burst", contentClasses: ["standard-form"] },
    position: { width: 640, height: "auto" },
    form: { handler: TableWindow.#save, submitOnChange: false, closeOnSubmit: false },
    actions: { reset: TableWindow.#reset, discard: TableWindow.#discard, engine: TableWindow.#engine }
  };
  constructor() { super(); this.v = null; this.dirty = false; }   // (v: the values the next render fills the form with; null = the table's)
  /** what the table holds, as the window shows it (the word set as every seat letters it) */
  current() { return PF.shownOf((k) => { try { return game.settings.get(MODULE_ID, k); } catch { return PF.TABLE[k]?.def; } }); }
  defaults() { return PF.defaultsFor(deps.guiLang()); }
  async _renderHTML() {
    const gm = isGM(), v = this.v ?? this.current(), f = foundry.applications.fields;
    const id = (k) => `mm-sfxt-${k}`;
    const row = (k) => {
      let input;
      if ( !gm ) input = `<output class="mm-sfxt-ro" id="${id(k)}">${esc(valueText(k, v[k]))}</output>`;
      else if ( SIZE_OF[k] ) input = `<span class="mm-sfxt-slide"><input type="range" id="${id(k)}" name="${k}" min="0" max="3" step="1" value="${v[k]}" data-dtype="Number">`
        + `<output for="${id(k)}">${esc(stepText(v[k]))}</output></span>`;
      else { const s = f.createSelectInput({ name: k, value: v[k], options: choicesOf(k).map((c) => ({ value: c, label: choiceLabel(k, c) })) }); s.id = id(k); input = s.outerHTML; }
      const hint = SIZE_OF[k] ? "" : `<p class="hint">${esc(T(`table.hint.${k}`))}</p>`;
      // (a GM's row: the table's value, shown only while the form holds another one - refreshDirty)
      const was = gm ? `<p class="mm-sfxt-was" hidden></p>` : "";
      return `<div class="form-group mm-sfxt-row" data-key="${k}"><label for="${id(k)}">${esc(T(`table.short.${k}`))}</label><div class="form-fields">${input}</div>${was}${hint}</div>`;
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
      ${gm ? `<div class="mm-sfxt-state" role="status" aria-live="polite"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><span class="mm-sfxt-state-text"></span>`
        + `<button type="button" class="mm-sfxt-discard" data-action="discard" hidden><i class="fa-solid fa-xmark" aria-hidden="true"></i> ${esc(T("table.discard"))}</button></div>` : ""}
      <footer class="form-footer">
        <button type="button" data-action="engine" data-tooltip="${esc(T("table.engineHint"))}"><i class="fa-solid fa-pen-nib"></i> ${esc(T("table.engine"))}</button>
        ${gm ? `<button type="button" class="mm-sfxt-reset" data-action="reset" data-tooltip="${esc(T("table.resetHint"))}"><i class="fa-solid fa-arrow-rotate-left"></i> ${esc(T("table.reset"))}</button>
        <button type="submit" class="mm-sfxt-save"><i class="fa-solid fa-floppy-disk"></i> ${esc(T("table.save"))}</button>` : ""}
      </footer>`;
    return root;
  }
  _replaceHTML(result, content) { content.replaceChildren(result); }
  _onRender() {
    win = this;
    this.refreshDirty();
    // (the form element outlives each render: its listeners once)
    if ( this.wired ) return;
    this.wired = true;
    const el = this.element;
    el.addEventListener("input", (e) => {
      const t = e.target;
      if ( t?.type === "range" ) { const o = t.parentElement?.querySelector("output"); if ( o ) o.textContent = stepText(Number(t.value)); }
      this.refreshDirty();
    });
    el.addEventListener("change", (e) => { this.refreshDirty(); if ( e.target?.name === "sfxLetters" ) el.querySelector(".mm-sfxt-body")?.classList.toggle("is-off", e.target.value === "off"); });
  }
  _onClose() { if ( win === this ) win = null; }
  /** MAPWIN: what the form holds against what the table holds: the status line, the changed rows (with the table's value), the buttons.
      Nothing is "changed" by touching a control and putting it back. -> the changed keys */
  refreshDirty() {
    const el = this.element; if ( !el || !isGM() ) return [];
    const table = this.current(), edited = this.values(), keys = PF.changedKeys(edited, table);
    this.dirty = keys.length > 0;
    for ( const row of el.querySelectorAll(".mm-sfxt-row") ) {
      const k = row.dataset.key, on = keys.includes(k), was = row.querySelector(".mm-sfxt-was");
      row.classList.toggle("is-changed", on);
      if ( was ) { was.hidden = !on; was.textContent = on ? F("table.was", { value: valueText(k, table[k]) }) : ""; }
    }
    const st = el.querySelector(".mm-sfxt-state");
    if ( st ) {
      st.classList.toggle("is-dirty", this.dirty);
      st.querySelector("i").className = `fa-solid ${this.dirty ? "fa-circle-exclamation" : "fa-circle-check"}`;
      st.querySelector(".mm-sfxt-state-text").textContent = this.dirty ? F(keys.length === 1 ? "table.state.dirtyOne" : "table.state.dirty", { n: keys.length }) : T("table.state.clean");
      st.querySelector(".mm-sfxt-discard").hidden = !this.dirty;
    }
    const save = el.querySelector(".mm-sfxt-save"); if ( save ) { save.disabled = !this.dirty; save.classList.toggle("is-dirty", this.dirty); }
    const reset = el.querySelector(".mm-sfxt-reset"); if ( reset ) reset.disabled = PF.changedKeys(edited, this.defaults()).length === 0;
    return keys;
  }
  /** the table changed (this GM saved, another GM, a macro, a reset): show it - a GM in the middle of an edit keeps his form, and its
      status line and rows are compared with the table's new values */
  follow() { if ( isGM() && this.dirty ) { this.refreshDirty(); return; } this.v = null; this.render(); }
  values() {
    const fd = new foundry.applications.ux.FormDataExtended(this.element).object, o = {};
    for ( const k of PF.TABLE_KEYS ) if ( k in fd ) o[k] = PF.clean(k, SIZE_OF[k] ? Number(fd[k]) : fd[k]);
    return o;
  }
  static async #save() {
    if ( !isGM() ) return;
    const next = this.values(), keys = PF.changedKeys(next, this.current());
    if ( !keys.length ) return;
    this.dirty = false; this.v = null;
    // (the stored value, not the shown one: a word set no GM named yet is written even when the form shows the shared set)
    for ( const k of PF.TABLE_KEYS ) if ( k in next && next[k] !== get(k) ) await game.settings.set(MODULE_ID, k, next[k]);
    ui.notifications?.info(T("table.saved"));
    this.render();
  }
  /** "Defaults" FILLS THE FORM (nothing reaches the table before "Save for the table": the status line says so) */
  static #reset() { if ( !isGM() ) return; this.v = this.defaults(); this.render(); }
  /** "Discard": the form shows the table's values again */
  static #discard() { if ( !isGM() ) return; this.v = null; this.render(); }
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
