import { MODULE_ID } from "../config.mjs";
import * as Water from "./water.mjs";
import * as Model from "./model.mjs";
import { TABS, SECTIONS, LOOK_GROUPS, COLOR_NAMES, FRAME_CHOICES, EXTRA_RANGE } from "./schema.mjs";
import { ALPHA_GROUPS, ALPHA_START } from "./paint.mjs";
import * as Rods from "./rods.mjs";
import { FX_DEFAULTS } from "./ripples.mjs";

/**
 * The water settings window: every setting of the engine, on six tabs (Look, Water, River, Fall, Rods, Output), applied live
 * (the map re-bakes a moment after the last change). A change to the colours or opacity repaints without baking.
 */

const T = (k) => game.i18n.localize(`MOINENMAPS.${k}`);
const has = (k) => game.i18n.has(`MOINENMAPS.${k}`);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const label = (key) => has(`Water.f.${key}`) ? T(`Water.f.${key}`) : key;
const hint = (key) => has(`Water.h.${key}`) ? T(`Water.h.${key}`) : "";
const hexOf = (c) => `#${String(c).replace("#", "")}`;

let panel = null;

export function openWaterPanel(tab) {
  if ( panel?.rendered ) { if ( tab ) panel.tab = tab; panel.render({ force: true }); panel.bringToFront?.(); return panel; }
  panel = new WaterPanel(); if ( tab ) panel.tab = tab;
  panel.render({ force: true });
  return panel;
}

class WaterPanel extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "moinen-maps-water", tag: "div", classes: ["moinen-maps-dialog", "mm-water-panel"],
    window: { icon: "fa-solid fa-water", resizable: true }, position: { width: 460, height: 680 }
  };

  tab = "look";
  #hook = null;
  #rodHook = null;
  #palTimer = 0;

  get title() { return T("Water.title"); }

  async _renderHTML() {
    const S = Water.state(), info = Water.waterInfo();
    const body = !S ? this.#emptyHtml() : !info ? `<p class="hint">${esc(T("Water.loading"))}</p>` : this.#tabHtml(S, info);
    const tabs = TABS.map((id) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${this.tab === id}"${this.tab === id ? "" : ' tabindex="-1"'}>${esc(T(`Water.tab.${id}`))}</button>`).join("");
    return `<div class="mm-wp-status" role="status" aria-live="polite">${esc(this.#statusText())}</div>
      <nav class="mm-wp-tabs" role="tablist" aria-label="${esc(T("Water.title"))}">${tabs}</nav>
      <div class="mm-wp-body" role="tabpanel">${body}</div>
      ${S ? `<footer class="mm-wp-foot"><button type="button" data-act="variation"><i class="fa-solid fa-dice" inert></i> ${esc(T("Water.variation"))}</button>
        <button type="button" data-act="clear" class="mm-danger"><i class="fa-solid fa-trash" inert></i> ${esc(T("Water.clear"))}</button></footer>` : ""}`;
  }

  _replaceHTML(result, content) {
    const keep = content.querySelector(".mm-wp-body")?.scrollTop ?? 0;
    content.innerHTML = result;
    const body = content.querySelector(".mm-wp-body"); if ( body ) body.scrollTop = keep;
    content.classList.add("mm-wp");
    if ( !content._mmWired ) {
      content._mmWired = true;
      content.addEventListener("click", (ev) => this.#onClick(ev));
      content.addEventListener("input", (ev) => this.#onInput(ev));
      content.addEventListener("change", (ev) => this.#onInput(ev));
      content.addEventListener("keydown", (ev) => this.#onKey(ev));
    }
  }

  _onFirstRender() {
    this.#hook = (kind) => { if ( kind === "status" ) this.#updateStatus(); else if ( kind === "loaded" ) this.render(); };
    this.#rodHook = () => { if ( this.tab === "rods" ) this.render(); };
    Hooks.on("moinenMapsRods", this.#rodHook);
    Hooks.on("moinenMapsWater", this.#hook);
  }

  _onClose() {
    if ( this.#hook ) Hooks.off("moinenMapsWater", this.#hook);
    if ( this.#rodHook ) Hooks.off("moinenMapsRods", this.#rodHook);
    this.#hook = this.#rodHook = null; panel = null;
  }

  /* ---------------------------------------------------------------- status */

  #statusText() {
    const st = Water.waterStatus(), S = Water.state();
    if ( st.error ) return `${T("Water.error")}: ${st.error}`;
    if ( !S || !Model.hasPaint(S) ) return T("Water.noPaint");
    if ( st.baking ) return game.i18n.format("MOINENMAPS.Water.baking", { n: Math.round(st.progress * 100) });
    return T("Water.ready");
  }

  #updateStatus() {
    const el = this.element?.querySelector(".mm-wp-status"); if ( el ) el.textContent = this.#statusText();
  }

  /* ---------------------------------------------------------------- markup */

  #emptyHtml() {
    return `<p class="hint">${esc(T("Water.empty"))}</p><button type="button" data-act="create"><i class="fa-solid fa-plus" inert></i> ${esc(T("Water.create"))}</button>`;
  }

  #tabHtml(S, info) {
    return (SECTIONS[this.tab] ?? []).map(([name, fields]) => {
      const rows = fields.map((f) => this.#field(f, S, info)).join("");
      return `<section class="mm-wp-sec">${name ? `<h4>${esc(T(`Water.sec.${name}`))}</h4>` : ""}${rows}</section>`;
    }).join("");
  }

  #rangeOf(key, info) {
    const r = info.range?.[key] ?? EXTRA_RANGE[key] ?? [0, 10];
    return Array.isArray(r) ? r : [r[1], r[2]];
  }

  #row(name, text, tip, control) {
    return `<div class="mm-wp-row"><label for="mm-wp-${name}"${tip ? ` data-tooltip="${esc(tip)}"` : ""}>${esc(text)}</label><div class="mm-wp-ctl">${control}</div></div>`;
  }

  #field(f, S, info) {
    const P = { ...FX_DEFAULTS, ...S.params };
    switch ( f.kind ) {
      case "range": {
        const [lo, hi] = this.#rangeOf(f.key, info);
        return this.#row(f.key, label(f.key), hint(f.key), `<range-picker id="mm-wp-${f.key}" name="${f.key}" min="${lo}" max="${hi}" step="1" value="${Number(P[f.key] ?? lo)}"></range-picker>`);
      }
      case "toggle":
        return this.#row(f.key, label(f.key), hint(f.key), `<input type="checkbox" id="mm-wp-${f.key}" name="${f.key}"${P[f.key] ? " checked" : ""}>`);
      case "select": {
        const opts = f.options.map((o) => `<option value="${o}"${P[f.key] === o ? " selected" : ""}>${esc(T(`Water.o.${f.key}.${o}`))}</option>`).join("");
        return this.#row(f.key, label(f.key), hint(f.key), `<select id="mm-wp-${f.key}" name="${f.key}">${opts}</select>`);
      }
      case "looks":
        return LOOK_GROUPS.map(([g, names]) => `<div class="mm-wp-looks"><h5>${esc(T(`Water.looks.${g}`))}</h5><div class="mm-wp-looklist">${names.filter((n) => info.looks[n]).map((n) => {
          const cols = info.looks[n].colors ?? [];
          return `<button type="button" data-look="${n}" aria-pressed="${P.style === n}" data-tooltip="${esc(T(`Water.look.${n}`))}"><span class="mm-wp-swatches">${cols.slice(1, 6).map((c) => `<i style="background:#${c}" inert></i>`).join("")}</span><span>${esc(T(`Water.look.${n}`))}</span></button>`;
        }).join("")}</div></div>`).join("");
      case "colors":
        return `<div class="mm-wp-colors">${COLOR_NAMES.map((n, i) => `<label class="mm-wp-color" data-tooltip="${esc(T(`Water.c.${n}`))}"><span>${esc(T(`Water.c.${n}`))}</span><color-picker name="color${i}" value="${hexOf(P.colors?.[i] ?? "000000")}"></color-picker></label>`).join("")}</div>`;
      case "palette": {
        const base = hexOf(P.palBase ?? P.colors?.[2] ?? "3f6c9a");
        const row = (k) => { const [lo, hi] = this.#rangeOf(k, info); return this.#row(k, label(k), hint(k), `<range-picker id="mm-wp-${k}" name="${k}" min="${lo}" max="${hi}" step="1" value="${Number(P[k] ?? info.defaults[k])}"></range-picker>`); };
        return `${this.#row("palBase", label("palBase"), hint("palBase"), `<color-picker id="mm-wp-palBase" name="palBase" value="${base}"></color-picker>`)}${row("palHue")}${row("palSat")}${row("palRange")}`;
      }
      case "frames":
        return this.#row("frames", label("frames"), hint("frames"), `<select id="mm-wp-frames" name="frames">${FRAME_CHOICES.map((n) => `<option value="${n}"${Number(P.frames) === n ? " selected" : ""}>${n}</option>`).join("")}</select>`);
      case "px": {
        const r = Model.sceneRect(), least = Model.clampPx(1, r);
        return this.#row("px", label("px"), hint("px"), `<range-picker id="mm-wp-px" name="px" min="${least}" max="64" step="1" value="${S.px}"></range-picker>`);
      }
      case "enabled":
        return this.#row("enabled", label("enabled"), hint("enabled"), `<input type="checkbox" id="mm-wp-enabled" name="enabled"${S.enabled ? " checked" : ""}>`);
      case "opacity":
        return ALPHA_GROUPS.map((g) => this.#row(`alpha.${g}`, T(`Water.a.${g}`), "", `<range-picker id="mm-wp-alpha.${g}" name="alpha.${g}" min="0" max="100" step="5" value="${Number(P.alpha?.[g] ?? ALPHA_START[g] ?? 100)}"></range-picker>`)).join("");
      case "rods": {
        const kind = game.settings.get(MODULE_ID, "waterRodKind"), branch = game.settings.get(MODULE_ID, "waterRodBranch"), n = (P.guides ?? []).length;
        return `<p class="hint">${esc(T("Water.rodsHint"))}</p>
          ${this.#row("rodKind", T("Water.rod.kind"), T("Water.rod.kindHint"), `<select id="mm-wp-rodKind" name="rodKind"><option value="flow"${kind === "flow" ? " selected" : ""}>${esc(T("Water.rod.flow"))}</option><option value="lip"${kind === "lip" ? " selected" : ""}>${esc(T("Water.rod.lip"))}</option></select>`)}
          ${this.#row("rodBranch", T("Water.rod.branch"), T("Water.rod.branchHint"), `<input type="checkbox" id="mm-wp-rodBranch" name="rodBranch"${branch ? " checked" : ""}>`)}
          <div class="mm-wp-rodbtns"><button type="button" data-act="rod-tool"><i class="fa-solid fa-bezier-curve" inert></i> ${esc(T("Water.rod.draw"))}</button>
            <button type="button" data-act="rod-reverse" data-tooltip="${esc(T("Water.rod.reverseHint"))}"><i class="fa-solid fa-arrows-left-right" inert></i> ${esc(T("Water.rod.reverse"))}</button>
            <button type="button" data-act="rod-undo"><i class="fa-solid fa-rotate-left" inert></i> ${esc(T("Water.rod.undo"))}</button>
            <button type="button" data-act="rod-clear" class="mm-danger"><i class="fa-solid fa-trash" inert></i> ${esc(T("Water.rod.clear"))} (${n})</button></div>`;
      }
      default:
        return "";
    }
  }

  /* ---------------------------------------------------------------- events */

  async #onClick(ev) {
    const b = ev.target.closest("button"); if ( !b ) return;
    const S = Water.state();
    if ( b.dataset.tab ) { this.tab = b.dataset.tab; return this.render(); }
    if ( b.dataset.look ) { Water.applyLook(b.dataset.look); return this.render(); }
    if ( b.dataset.act === "create" ) { await Water.ensureState(); return this.render(); }
    if ( b.dataset.act === "rod-tool" ) return ui.controls.activate({ control: "moinenmaps", tool: Rods.RODS_TOOL });
    if ( b.dataset.act === "rod-reverse" ) return Rods.reverseSelected();
    if ( b.dataset.act === "rod-undo" ) return Rods.undoRod();
    if ( b.dataset.act === "rod-clear" ) { Rods.clearRods(); return this.render(); }
    if ( b.dataset.act === "variation" ) { Water.newVariation(); return; }
    if ( b.dataset.act === "clear" && S ) {
      const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: T("Water.clear") }, content: `<p>${esc(T("Water.clearConfirm"))}</p>`, rejectClose: false });
      if ( ok ) Water.clearAll();
    }
  }

  #onKey(ev) {
    const t = ev.target.closest?.('[role="tab"]'); if ( !t || !["ArrowLeft", "ArrowRight"].includes(ev.key) ) return;
    const i = TABS.indexOf(this.tab) + (ev.key === "ArrowRight" ? 1 : -1);
    this.tab = TABS[(i + TABS.length) % TABS.length];
    this.render().then(() => this.element?.querySelector(`[data-tab="${this.tab}"]`)?.focus());
  }

  #onInput(ev) {
    const S = Water.state(); if ( !S ) return;
    const el = ev.target.closest?.("range-picker, color-picker, select, input[type=checkbox]"); if ( !el || !el.name ) return;
    const name = el.name;
    const value = el.matches("input[type=checkbox]") ? el.checked : el.matches("select") ? el.value : el.value;
    if ( name.startsWith("color") && /^color\d$/.test(name) ) {
      const colors = [...S.params.colors]; colors[Number(name.slice(5))] = String(value).replace("#", "").toLowerCase();
      return Water.setParams({ colors });
    }
    if ( name.startsWith("alpha.") ) return Water.setParams({ alpha: { ...S.params.alpha, [name.slice(6)]: Number(value) } });
    if ( ["palBase", "palHue", "palSat", "palRange"].includes(name) ) return this.#palette(name, value);
    if ( name === "rodKind" ) return game.settings.set(MODULE_ID, "waterRodKind", String(value));
    if ( name === "rodBranch" ) return game.settings.set(MODULE_ID, "waterRodBranch", !!value);
    if ( name === "px" ) { Water.setPx(Number(value)); return; }
    if ( name === "enabled" ) return Water.setEnabled(!!value);
    if ( name === "frames" ) return Water.setParams({ frames: Number(value) });
    if ( name === "fallStyle" || name === "light" || name === "fxWho" ) return Water.setParams({ [name]: String(value) });
    if ( typeof value === "boolean" ) { Water.setParams({ [name]: value }); return; }
    const num = Number(value); if ( Number.isFinite(num) ) Water.setParams({ [name]: num });
  }

  /** Six colours from one, as the base colour or a slider moves. */
  #palette(name, value) {
    const S = Water.state(), P = S.params;
    const next = { palBase: P.palBase ?? hexOf(P.colors[2]), palHue: P.palHue, palSat: P.palSat, palRange: P.palRange, [name]: name === "palBase" ? value : Number(value) };
    clearTimeout(this.#palTimer);
    this.#palTimer = setTimeout(async () => {
      await Water.colorsFrom(String(next.palBase).replace("#", "").toLowerCase(), next.palHue, next.palSat, next.palRange);
      this.element?.querySelectorAll("color-picker[name^=color]").forEach((cp) => { cp.value = hexOf(Water.state().params.colors[Number(cp.name.slice(5))]); });
    }, 120);
  }
}
