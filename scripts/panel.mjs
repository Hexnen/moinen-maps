/**
 * Districts panel: a window listing every district of the scene. DOM is built once and updated by key (district id), so painting,
 * erasing or another GM's edit only touches the rows that changed. Order in the list is the stacking order on the canvas.
 */
import { MODULE_ID, sceneConfig } from "./config.mjs";
import { swatchesHtml, wireSwatches } from "./tools.mjs";
import { fitDialog, liveBarHtml, wireLiveBar, frameThrottle } from "./labels.mjs";
import { attrsOf, setAttrById, stepAttrById, totals, fmt } from "./attrs.mjs";
import { setDraft, clearDraft, listDistricts, saveDistricts, panToDistrict, pulseDistrict, previewHover, openEditor, setLocalHidden, isLocalHidden } from "./districts.mjs";

const T = (k) => game.i18n.localize(`MOINENMAPS.${k}`);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const { ApplicationV2 } = foundry.applications.api;

export class DistrictsPanel extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "moinen-maps-districts", classes: ["moinen-maps-panel"], tag: "div",
    window: { title: "MOINENMAPS.Panel.title", icon: "fa-solid fa-draw-polygon", resizable: true },
    position: { width: 420, height: 560 }
  };

  /** @type {Set<string>} */ selected = new Set();
  filter = "";
  sortBy = "";      // lower-cased attribute name, "" = canvas order
  sortDir = -1;     // -1 = largest first
  #sortSig = "";
  #rows = new Map();
  #hooks = [];
  #timer = 0;
  get readOnly() { return !game.user.isGM; }

  async _renderHTML() {
    const root = document.createElement("div");
    root.className = "mm-panel";
    root.innerHTML = `
      <div class="mm-panel-head">
        <input type="search" class="mm-search" placeholder="${esc(T("Panel.search"))}" aria-label="${esc(T("Panel.search"))}">
        <span class="mm-count" data-mm="count" role="status"></span>
      </div>
      <div class="mm-sortbar" data-mm="sortbar" hidden>
        <label for="mm-sort-${this.id}">${esc(T("Attr.sort"))}</label>
        <select id="mm-sort-${this.id}" data-mm="sort"></select>
        <button type="button" class="mm-icon" data-act="sortdir" aria-pressed="false" aria-label="${esc(T("Attr.sortDir"))}" data-tooltip="${esc(T("Attr.sortDir"))}"><i class="fa-solid fa-arrow-down-wide-short" inert></i></button>
      </div>
      ${this.readOnly ? "" : `<div class="mm-panel-actions">
        <button type="button" data-act="reveal-all"><i class="fa-solid fa-eye" inert></i> ${esc(T("Panel.revealAll"))}</button>
        <button type="button" data-act="hide-all"><i class="fa-solid fa-eye-slash" inert></i> ${esc(T("Panel.hideAll"))}</button>
      </div>
      <div class="mm-bulk" data-mm="bulk" role="toolbar" aria-label="${esc(T("Panel.bulk"))}" hidden>
        <span data-mm="bulkcount" role="status"></span>
        <button type="button" data-act="bulk-reveal" aria-label="${esc(T("Panel.reveal"))}" data-tooltip="${esc(T("Panel.reveal"))}"><i class="fa-solid fa-eye" inert></i></button>
        <button type="button" data-act="bulk-hide" aria-label="${esc(T("Panel.hide"))}" data-tooltip="${esc(T("Panel.hide"))}"><i class="fa-solid fa-eye-slash" inert></i></button>
        <button type="button" data-act="bulk-color" aria-label="${esc(T("Panel.recolor"))}" data-tooltip="${esc(T("Panel.recolor"))}"><i class="fa-solid fa-palette" inert></i></button>
        <button type="button" data-act="bulk-delete" aria-label="${esc(T("Panel.delete"))}" data-tooltip="${esc(T("Panel.delete"))}"><i class="fa-solid fa-trash" inert></i></button>
        <button type="button" data-act="bulk-clear" aria-label="${esc(T("Panel.clearSel"))}" data-tooltip="${esc(T("Panel.clearSel"))}"><i class="fa-solid fa-xmark" inert></i></button>
      </div>`}
      <ul class="mm-list" data-mm="list"></ul>
      <p class="mm-empty" data-mm="empty" hidden>${esc(T("Panel.empty"))}</p>
      <footer class="mm-totals" data-mm="totals" aria-label="${esc(T("Attr.totals"))}" hidden></footer>`;
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
    this.#rows.clear();
    this.#bind(result);
    this.sync();
  }

  _onFirstRender() {
    this.#hooks.push(["moinenMapsDistrictsChanged", Hooks.on("moinenMapsDistrictsChanged", () => this.#queue())],
      ["moinenMapsDistrictHover", Hooks.on("moinenMapsDistrictHover", (id) => this.#markHover(id))]);
  }

  _onClose() {
    for ( const [n, id] of this.#hooks ) Hooks.off(n, id);
    this.#hooks = [];
    clearTimeout(this.#timer);
    previewHover(null);
  }

  #queue() { clearTimeout(this.#timer); this.#timer = setTimeout(() => this.sync(), 30); }

  /* ------------------------------------------------------------ keyed DOM sync */

  sync() {
    const root = this.element?.querySelector(".mm-panel");
    if ( !root ) return;
    const all = listDistricts().filter((d) => game.user.isGM || d.revealed);
    const attrMap = new Map(all.map((d) => [d.id, attrsOf(d)]));
    this.#syncSortUi(root, attrMap);
    const list = this.sortBy ? this.#sorted(all, attrMap) : all;
    const ul = root.querySelector('[data-mm="list"]');
    ul.classList.toggle("is-sorted", !!this.sortBy);
    this.#renderTotals(root, all);
    const ids = new Set(list.map((d) => d.id));
    for ( const [id, li] of this.#rows ) if ( !ids.has(id) ) { li.remove(); this.#rows.delete(id); this.selected.delete(id); }
    const q = this.filter.trim().toLowerCase();
    let prev = null;
    for ( const d of list ) {
      let li = this.#rows.get(d.id);
      if ( !li ) { li = this.#makeRow(d); this.#rows.set(d.id, li); }
      this.#updateRow(li, d, attrMap.get(d.id) ?? []);
      li.hidden = !!q && !(d.name || T("Panel.unnamed")).toLowerCase().includes(q);
      // keep DOM order = list order, moving only rows that are out of place
      const should = prev ? prev.nextElementSibling : ul.firstElementChild;
      if ( should !== li ) ul.insertBefore(li, should);
      prev = li;
    }
    root.querySelector('[data-mm="count"]').textContent = game.i18n.format("MOINENMAPS.Panel.count", { n: list.length, r: list.filter((d) => d.revealed).length });
    root.querySelector('[data-mm="empty"]').hidden = !!list.length;
    this.#updateBulk(root);
  }

  #makeRow(d) {
    const li = document.createElement("li");
    li.className = "mm-row"; li.dataset.id = d.id; li.draggable = false;   // draggable only while the grip is held, so the number fields stay selectable
    li.innerHTML = `${this.readOnly ? "" : `<input type="checkbox" class="mm-sel"><i class="fa-solid fa-grip-vertical mm-grip" aria-hidden="true"></i>`}
      <span class="mm-swatchdot"></span><span class="mm-name" tabindex="0"></span>
      ${this.readOnly ? "" : `<button type="button" class="mm-icon" data-act="eye" aria-pressed="false" aria-label="${esc(T("Panel.toggleReveal"))}" data-tooltip="${esc(T("Panel.toggleReveal"))}"><i class="fa-solid" inert></i></button>
      <button type="button" class="mm-icon" data-act="local" aria-pressed="false" aria-label="${esc(T("Panel.toggleLocal"))}" data-tooltip="${esc(T("Panel.toggleLocal"))}"><i class="fa-solid" inert></i></button>
      <button type="button" class="mm-icon" data-act="edit" aria-label="${esc(T("Panel.edit"))}" data-tooltip="${esc(T("Panel.edit"))}"><i class="fa-solid fa-pen" inert></i></button>
      <button type="button" class="mm-icon mm-danger" data-act="delete" aria-label="${esc(T("Panel.delete"))}" data-tooltip="${esc(T("Panel.delete"))}"><i class="fa-solid fa-trash" inert></i></button>`}
      <div class="mm-chips" data-mm="chips" hidden></div>`;
    return li;
  }

  #updateRow(li, d, attrs = []) {
    const none = !d.color || d.color === "none";
    const dot = li.querySelector(".mm-swatchdot");
    dot.classList.toggle("none", none);
    dot.style.setProperty("--c", none ? "transparent" : d.color);
    const name = li.querySelector(".mm-name"), label = d.name || T("Panel.unnamed");
    if ( name.textContent !== label && !name.isContentEditable ) name.textContent = label;
    name.classList.toggle("unnamed", !d.name);
    li.classList.toggle("hidden-district", !d.revealed);
    li.classList.toggle("selected", this.selected.has(d.id));
    this.#updateChips(li, d, attrs);
    const cb = li.querySelector(".mm-sel"); if ( cb ) { cb.checked = this.selected.has(d.id); cb.setAttribute("aria-label", `${T("Panel.select")}: ${label}`); }
    const eye = li.querySelector('[data-act="eye"]'); if ( eye ) { eye.firstElementChild.className = `fa-solid ${d.revealed ? "fa-eye" : "fa-eye-slash"}`; eye.setAttribute("aria-pressed", String(!!d.revealed)); }
    const loc = li.querySelector('[data-act="local"]'); if ( loc ) { loc.firstElementChild.className = `fa-solid ${isLocalHidden(d.id) ? "fa-lock" : "fa-lock-open"}`; loc.setAttribute("aria-pressed", String(isLocalHidden(d.id))); }
  }

  /** Attribute chips of a row, reconciled by attribute id so a number being typed keeps its focus. */
  #updateChips(li, d, attrs) {
    const host = li.querySelector('[data-mm="chips"]'), shown = attrs.filter((a) => a.name);
    host.hidden = !shown.length;
    const have = new Map([...host.children].map((c) => [c.dataset.attr, c]));
    let prev = null;
    for ( const a of shown ) {
      let c = have.get(a.id);
      if ( !c ) {
        c = document.createElement("span"); c.className = "mm-chip"; c.dataset.attr = a.id;
        c.innerHTML = this.readOnly
          ? `<span class="mm-chip-name"></span><span class="mm-chip-static"></span>`
          : `<span class="mm-chip-name"></span><button type="button" class="mm-step" data-act="dec" tabindex="-1">−</button><input type="number" step="any" class="mm-chip-val"><button type="button" class="mm-step" data-act="inc" tabindex="-1">+</button>`;
      }
      have.delete(a.id);
      c.classList.toggle("gm", !a.players && !this.readOnly);
      c.title = !a.players && !this.readOnly ? T("Attr.gmOnly") : "";
      c.querySelector(".mm-chip-name").textContent = a.name;
      if ( this.readOnly ) c.querySelector(".mm-chip-static").textContent = fmt(a.value);
      else {
        const inp = c.querySelector(".mm-chip-val");
        if ( document.activeElement !== inp ) inp.value = a.value ?? "";
        inp.setAttribute("aria-label", a.name);
        c.querySelector('[data-act="dec"]').setAttribute("aria-label", game.i18n.format("MOINENMAPS.Attr.dec", { name: a.name }));
        c.querySelector('[data-act="inc"]').setAttribute("aria-label", game.i18n.format("MOINENMAPS.Attr.inc", { name: a.name }));
      }
      const should = prev ? prev.nextElementSibling : host.firstElementChild;
      if ( should !== c ) host.insertBefore(c, should);
      prev = c;
    }
    for ( const c of have.values() ) c.remove();
  }

  /** The sort selector lists every attribute name on the scene; it is rebuilt only when that set changes. */
  #syncSortUi(root, attrMap) {
    const names = new Map();
    for ( const list of attrMap.values() ) for ( const a of list ) { const k = a.name?.trim().toLocaleLowerCase(); if ( k && !names.has(k) ) names.set(k, a.name.trim()); }
    if ( this.sortBy && !names.has(this.sortBy) ) this.sortBy = "";
    const sig = JSON.stringify([...names]) + this.sortBy;
    const bar = root.querySelector('[data-mm="sortbar"]'), sel = bar.querySelector("select");
    bar.hidden = !names.size;
    if ( sig !== this.#sortSig ) {
      this.#sortSig = sig;
      sel.replaceChildren(new Option(T("Attr.sortCanvas"), ""), ...[...names].map(([k, n]) => new Option(n, k)));
      sel.value = this.sortBy;
    }
    const dir = bar.querySelector('[data-act="sortdir"]');
    dir.setAttribute("aria-pressed", String(this.sortDir > 0));
    dir.firstElementChild.className = `fa-solid ${this.sortDir > 0 ? "fa-arrow-up-short-wide" : "fa-arrow-down-wide-short"}`;
    dir.disabled = !this.sortBy;
  }

  #sorted(list, attrMap) {
    const key = this.sortBy, dir = this.sortDir;
    const val = (d) => attrMap.get(d.id)?.find((a) => a.name?.trim().toLocaleLowerCase() === key)?.value ?? null;
    return list.map((d, i) => ({ d, i, v: val(d) })).sort((a, b) => {
      if ( a.v === null || b.v === null ) return a.v === b.v ? a.i - b.i : a.v === null ? 1 : -1;   // empty values always last
      return (a.v - b.v) * dir || a.i - b.i;
    }).map((x) => x.d);
  }

  #renderTotals(root, list) {
    const host = root.querySelector('[data-mm="totals"]'), t = totals(list);
    host.hidden = !t.length;
    const sig = JSON.stringify([t, this.sortBy]);
    if ( host.dataset.sig === sig ) return;
    host.dataset.sig = sig;
    host.replaceChildren(Object.assign(document.createElement("span"), { className: "mm-totals-title", textContent: T("Attr.totals") }),
      ...t.map((x) => {
        const b = document.createElement("button"); b.type = "button"; b.className = "mm-total"; b.dataset.act = "sortby"; b.dataset.key = x.name.toLocaleLowerCase();
        b.setAttribute("aria-pressed", String(this.sortBy === b.dataset.key));
        b.innerHTML = `<span class="mm-total-name"></span><b class="mm-total-sum"></b>`;
        b.querySelector(".mm-total-name").textContent = x.name; b.querySelector(".mm-total-sum").textContent = fmt(x.sum);
        return b;
      }));
  }

  #markHover(id) {
    for ( const [rid, li] of this.#rows ) li.classList.toggle("is-hover", rid === id);
  }

  #updateBulk(root) {
    const bulk = root.querySelector('[data-mm="bulk"]'); if ( !bulk ) return;
    bulk.hidden = !this.selected.size;
    bulk.querySelector('[data-mm="bulkcount"]').textContent = game.i18n.format("MOINENMAPS.Panel.selected", { n: this.selected.size });
  }

  /* ------------------------------------------------------------ interaction */

  async #mutate(ids, fn) {
    const list = listDistricts();
    for ( const d of list ) if ( ids.includes(d.id) ) fn(d);
    await saveDistricts(list);
  }

  #bind(root) {
    const ul = root.querySelector('[data-mm="list"]');
    root.querySelector(".mm-search").addEventListener("input", (e) => { this.filter = e.target.value; this.sync(); });

    ul.addEventListener("click", async (e) => {
      const li = e.target.closest(".mm-row"); if ( !li ) return;
      const id = li.dataset.id, act = e.target.closest("[data-act]")?.dataset.act;
      const step = e.target.closest(".mm-step");
      if ( step ) {
        const delta = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * (step.dataset.act === "inc" ? 1 : -1);
        return stepAttrById(id, step.closest(".mm-chip").dataset.attr, delta);
      }
      if ( e.target.closest(".mm-chips") ) return;   // typing a number must not pan the map
      if ( e.target.classList.contains("mm-sel") ) {
        e.target.checked ? this.selected.add(id) : this.selected.delete(id);
        li.classList.toggle("selected", e.target.checked); this.#updateBulk(root); return;
      }
      if ( act === "eye" ) return this.#mutate([id], (d) => { d.revealed = !d.revealed; });
      if ( act === "local" ) { setLocalHidden(id, !isLocalHidden(id)); this.sync(); return; }
      if ( act === "edit" ) return openEditor(id);
      if ( act === "delete" ) return this.#delete([id]);
      if ( e.target.closest(".mm-name")?.isContentEditable ) return;
      panToDistrict(id); pulseDistrict(id);
    });
    ul.addEventListener("dblclick", (e) => {
      const li = e.target.closest(".mm-row"); if ( !li || this.readOnly ) return;
      if ( e.target.closest(".mm-name") ) this.#rename(li);
      else if ( !e.target.closest("[data-act], .mm-chips") && !e.target.classList.contains("mm-sel") ) openEditor(li.dataset.id);
    });
    ul.addEventListener("keydown", (e) => { if ( e.key === "Enter" && e.target.classList.contains("mm-name") && !e.target.isContentEditable ) panToDistrict(e.target.closest(".mm-row").dataset.id); });
    ul.addEventListener("change", (e) => {
      if ( !e.target.matches(".mm-chip-val") ) return;
      setAttrById(e.target.closest(".mm-row").dataset.id, e.target.closest(".mm-chip").dataset.attr, e.target.value);
    });
    ul.addEventListener("pointerover", (e) => { const li = e.target.closest(".mm-row"); if ( li ) previewHover(li.dataset.id); });
    ul.addEventListener("pointerleave", () => previewHover(null));

    // drag to reorder: the list order is the canvas stacking order
    let dragId = null;
    ul.addEventListener("pointerdown", (e) => { const g = e.target.closest(".mm-grip"); if ( g && !this.sortBy ) g.closest(".mm-row").draggable = true; });
    ul.addEventListener("dragstart", (e) => { const li = e.target.closest(".mm-row"); if ( !li ) return; dragId = li.dataset.id; li.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragId); });
    ul.addEventListener("dragend", () => { ul.querySelectorAll(".dragging, .drop-before, .drop-after").forEach((x) => x.classList.remove("dragging", "drop-before", "drop-after")); ul.querySelectorAll('.mm-row[draggable="true"]').forEach((x) => { x.draggable = false; }); dragId = null; });
    ul.addEventListener("dragover", (e) => {
      if ( !dragId ) return; e.preventDefault();
      const li = e.target.closest(".mm-row"); ul.querySelectorAll(".drop-before, .drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after"));
      if ( li && li.dataset.id !== dragId ) { const r = li.getBoundingClientRect(); li.classList.add(e.clientY < r.top + r.height / 2 ? "drop-before" : "drop-after"); }
    });
    ul.addEventListener("drop", async (e) => {
      if ( !dragId ) return; e.preventDefault();
      const li = e.target.closest(".mm-row"); const id = dragId; dragId = null;
      const list = listDistricts(), from = list.findIndex((d) => d.id === id); if ( from < 0 ) return;
      const [item] = list.splice(from, 1);
      if ( li && li.dataset.id !== id ) {
        let to = list.findIndex((d) => d.id === li.dataset.id);
        if ( !li.classList.contains("drop-before") ) to++;
        list.splice(to, 0, item);
      } else list.push(item);
      await saveDistricts(list);
    });

    root.querySelector('[data-mm="sort"]').addEventListener("change", (e) => { this.sortBy = e.target.value; this.sync(); });
    root.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-act]"), act = btn?.dataset.act; if ( !act || e.target.closest(".mm-list") ) return;
      if ( act === "sortdir" ) { this.sortDir = -this.sortDir; return this.sync(); }
      if ( act === "sortby" ) {   // a total doubles as a shortcut: sort by it, again to flip the direction
        if ( this.sortBy === btn.dataset.key ) this.sortDir = -this.sortDir; else { this.sortBy = btn.dataset.key; this.sortDir = -1; }
        root.querySelector('[data-mm="totals"]').dataset.sig = ""; this.#sortSig = "";
        return this.sync();
      }
      const all = listDistricts().map((d) => d.id), sel = [...this.selected];
      switch ( act ) {
        case "reveal-all": return this.#mutate(all, (d) => { d.revealed = true; });
        case "hide-all": return this.#mutate(all, (d) => { d.revealed = false; });
        case "bulk-reveal": return this.#mutate(sel, (d) => { d.revealed = true; });
        case "bulk-hide": return this.#mutate(sel, (d) => { d.revealed = false; });
        case "bulk-delete": return this.#delete(sel);
        case "bulk-clear": this.selected.clear(); return this.sync();
        case "bulk-color": return this.#recolor(sel);
      }
    });
  }

  #rename(li) {
    const name = li.querySelector(".mm-name"), id = li.dataset.id, before = listDistricts().find((d) => d.id === id)?.name ?? "";
    name.contentEditable = "plaintext-only"; name.textContent = before; name.focus();
    getSelection().selectAllChildren(name);
    const done = async (commit) => {
      name.removeEventListener("blur", onBlur); name.removeEventListener("keydown", onKey);
      const v = name.textContent.trim(); name.contentEditable = "false";
      if ( commit && v !== before ) await this.#mutate([id], (d) => { d.name = v; });
      this.sync();
    };
    const onBlur = () => done(true), onKey = (e) => { if ( e.key === "Enter" ) { e.preventDefault(); name.blur(); } else if ( e.key === "Escape" ) { e.preventDefault(); name.removeEventListener("blur", onBlur); done(false); } };
    name.addEventListener("blur", onBlur); name.addEventListener("keydown", onKey);
  }

  async #delete(ids) {
    if ( !ids.length ) return;
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: T("Panel.delete") }, content: `<p>${esc(game.i18n.format("MOINENMAPS.Panel.deleteConfirm", { n: ids.length }))}</p>` });
    if ( !ok ) return;
    const list = listDistricts().filter((d) => !ids.includes(d.id));
    ids.forEach((i) => this.selected.delete(i));
    await saveDistricts(list);
  }

  async #recolor(ids) {
    if ( !ids.length ) return;
    const DialogV2 = foundry.applications.api.DialogV2;
    let reopen = false, done = false;
    try {
    await DialogV2.prompt({
      window: { title: T("Panel.recolor"), icon: "fa-solid fa-palette" }, classes: ["moinen-maps-dialog"], position: { width: 340 },
      content: `${liveBarHtml()}${swatchesHtml("", false, true)}<input type="hidden" name="pick" value="">`,
      render: (_e, dlg) => {
        const el = dlg.element, pick = el.querySelector('[name="pick"]');
        wireSwatches(el, pick); fitDialog(dlg);
        // live: the selected districts wear the colour being chosen
        const show = frameThrottle(() => { if ( done ) return; if ( pick.value ) ids.forEach((id) => setDraft(id, { color: pick.value })); else ids.forEach((id) => clearDraft(id)); });
        for ( const ev of ["input", "change", "click"] ) el.addEventListener(ev, show);
        wireLiveBar(el, () => { reopen = true; dlg.close(); });
      },
      ok: { label: T("Apply"), icon: "fa-solid fa-check", callback: (_e, b) => { const c = b.form.querySelector('[name="pick"]').value; if ( c ) return this.#mutate(ids, (d) => { d.color = c; }); } },
      rejectClose: false
    });
    } finally { done = true; ids.forEach((id) => clearDraft(id)); }
    if ( reopen ) this.#recolor(ids);
  }
}

let panel = null;
export function toggleDistrictsPanel(force) {
  if ( panel?.rendered && force !== true ) { panel.close(); return false; }
  panel ??= new DistrictsPanel();
  panel.render({ force: true, position: { height: Math.min(560, window.innerHeight - 64) } });   // never taller than the window
  return true;
}
export const districtsPanel = () => panel;
export const playersMayList = () => !!sceneConfig(canvas.scene ?? game.scenes.viewed)?.districtListForPlayers;
void MODULE_ID;
