import { registerSection } from "../workspace/registry.mjs";
import { esc, T, setting, optRange, optCheck, optHint, bindSettings } from "../workspace/ui.mjs";
import * as Zones from "./zones.mjs";
import * as Editor from "./editor.mjs";
import { presets } from "./presets.mjs";
import * as Styles from "./styles.mjs";

/**
 * Zones as a workspace section (takes over the "zones" placeholder of soon.mjs). Tools: the hand, the pencil, the eraser; actions:
 * trim (cut away every bit of line that does not bound a zone) and clear. Bar: undo / redo, the join-gaps distance (pencil) or the
 * eraser size, and how many zones there are. Dock: the movement preset and who sees the zones, then how they look.
 * While this section is open the GM sees the raw pencil lines; anywhere else only the finished zones show.
 */

const TOOLS = { "mm-z-pick": null, "mm-z-draw": "draw", "mm-z-erase": "erase" };

let watching = false;
function watch() {
  if ( watching ) return;
  watching = true;
  Hooks.on("moinenMapsTool", (tool, _prev, sectionId) => {
    Zones.setInSection(sectionId === "zones");
    const want = TOOLS[tool] ?? null;
    if ( Editor.currentMode() !== want ) Editor.setMode(want);
  });
}

const Z = (k, d) => (d ? game.i18n.format(`MOINENMAPS.Zones.${k}`, d) : game.i18n.localize(`MOINENMAPS.Zones.${k}`));

function statusText() {
  const z = Zones.zones(), S = Zones.state();
  const n = z?.zones.length ?? 0, lines = S?.strokes.size ?? 0;
  return Z("status", { zones: n, lines });
}

function bar(host, ctx) {
  const mode = TOOLS[ctx?.tool] ?? null;
  const S = Zones.state();
  const btn = (act, icon, title, disabled = false, label = "") => `<button type="button" class="mm-ws-btn" data-act="${act}" aria-label="${esc(Z(title))}" data-tooltip="${esc(Z(title))}"${disabled ? " disabled" : ""}><i class="${icon}" inert></i>${label ? ` ${esc(label)}` : ""}</button>`;
  const render = () => {
    const size = mode === "erase"
      ? optRange({ name: "eraser", label: Z("f.eraser"), value: setting("zonesEraser") ?? 0.5, min: 0.1, max: 4, step: 0.1, hint: Z("h.eraser") })
      : mode === "draw" ? optRange({ name: "snap", label: Z("f.snap"), value: S?.snap ?? 0.25, min: 0, max: 1, step: 0.05, hint: Z("h.snap") }) : "";
    const smooth = optRange({ name: "smooth", label: Z("f.smooth"), value: S?.smooth ?? 0.3, min: 0, max: 1, step: 0.05, hint: Z("h.smooth") });
    host.innerHTML = `${btn("undo", "fa-solid fa-rotate-left", "undo", !Zones.canUndo())}${btn("redo", "fa-solid fa-rotate-right", "redo", !Zones.canRedo())}
      ${btn("trim", "fa-solid fa-scissors", "trimHint", !Zones.zones(), Z("trim"))}
      ${smooth}${size}<span class="mm-ws-hint mm-z-status">${esc(statusText())}</span>
      ${optHint(Z(mode === "erase" ? "hintErase" : mode === "draw" ? "hintDraw" : "hintPick"))}`;
  };
  render();
  const onClick = (ev) => {
    const b = ev.target.closest("[data-act]"); if ( !b ) return;
    const a = b.dataset.act;
    if ( a === "undo" ) Zones.undoEdit(); else if ( a === "redo" ) Zones.redoEdit(); else if ( a === "trim" ) Zones.trim();
  };
  const onChange = (ev) => {
    // only the control's own event (its name ATTRIBUTE: a range-picker has no name property); its inner inputs carry no name
    const name = ev.target?.getAttribute?.("name");
    if ( name !== "snap" && name !== "smooth" ) return;
    Zones.setParams({ [name]: Number(ev.target.value) });
  };
  host.addEventListener("click", onClick);
  host.addEventListener("change", onChange);
  const off = bindSettings(host, { eraser: { key: "zonesEraser", read: (c) => Math.min(4, Math.max(0.1, Number(c.value) || 0.5)) } });
  // the counts and undo buttons follow every edit (re-rendered unless a slider is in hand)
  const hook = Hooks.on("moinenMapsZones", (kind) => { if ( kind === "edited" || kind === "loaded" ) { if ( !host.contains(document.activeElement) ) render(); else host.querySelector(".mm-z-status")?.replaceChildren(statusText()); } });
  return () => { host.removeEventListener("click", onClick); host.removeEventListener("change", onChange); off(); Hooks.off("moinenMapsZones", hook); };
}

// which groups of the settings panel are open (kept while the panel is re-drawn)
const openFolds = new Set(["look", "hover"]);

/** The scene's zone settings (preset, who sees them, look) and this user's own (distances, ruler). */
function settingsPanel(host) {
  const render = () => {
    const S = Zones.state(); if ( !S ) { host.innerHTML = `<p class="hint">${esc(Z("noScene"))}</p>`; return; }
    const L = Zones.look(), from = S.lookFrom ?? "", world = Styles.worldStyle(), wPreset = Styles.worldPreset();
    const styles = Styles.styles(), styleName = (id) => styles.find((x) => x.id === id)?.name ?? id;
    const moves = presets().map((p) => [p.id, game.i18n.localize(p.title)]), moveName = (id) => moves.find((m) => m[0] === id)?.[1] ?? id;
    const mine = from.startsWith("u-");
    const row = (label, ctl, hint = "") => `<div class="mm-wp-row"><label${hint ? ` data-tooltip="${esc(hint)}"` : ""}>${esc(label)}</label><div class="mm-wp-ctl">${ctl}</div></div>`;
    const sel = (name, opts, v) => `<select name="${name}">${opts.map(([k, l]) => `<option value="${esc(k)}"${k === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    const range = (name, min, max) => `<range-picker name="${name}" min="${min}" max="${max}" step="0.05" value="${L[name]}"></range-picker>`;
    const fold = (id, title, icon, body) => `<details class="mm-fold mm-z-fold" data-fold="${id}"${openFolds.has(id) ? " open" : ""}><summary><i class="${icon}" inert></i> ${esc(title)}</summary><div class="mm-fold-body">${body}</div></details>`;
    const opts = (name, keys, v) => sel(name, keys.map((k) => [k, Z(`${name}.${k}`)]), v);
    const iconBtn = (act, icon, title, cls = "") => `<button type="button" class="mm-ws-btn mm-z-icon ${cls}" data-act="${act}" aria-label="${esc(title)}" data-tooltip="${esc(title)}"><i class="${icon}" inert></i></button>`;
    const rules = `${Z("h.preset")} ${Z(`presetInfo.${Zones.movePreset()}`)}`;
    host.innerHTML = `<section class="mm-wp-sec mm-z-panel">
      <h4>${esc(Z("sec.map"))}</h4>
      ${row(Z("f.preset"), sel("preset", [["", Z("fromWorld", { name: moveName(wPreset) })], ...moves], S.preset ?? ""), rules)}
      ${row(Z("f.style"), `<div class="mm-z-inline">${sel("lookFrom", [["", Z("fromWorld", { name: styleName(world) })], ...styles.map((x) => [x.id, x.name]), ["custom", Z("style.custom")]], from)}
        ${iconBtn("saveStyle", "fa-solid fa-floppy-disk", Z("style.save"))}${mine ? iconBtn("delStyle", "fa-solid fa-trash", Z("style.delete"), "mm-danger") : ""}</div>`, Z("h.style"))}
      ${row(Z("f.who"), opts("who", ["all", "gm", "none"], L.who), Z("h.who"))}
      ${fold("look", Z("grp.look"), "fa-solid fa-draw-polygon", `
        ${row(Z("f.fill"), range("fill", 0, 1))}
        ${row(Z("f.ink"), range("ink", 0, 2))}
        ${row(Z("f.lineAlpha"), range("lineAlpha", 0, 1))}
        ${row(Z("f.lineStyle"), opts("lineStyle", ["dashed", "solid", "dotted", "dashdot", "double", "glow", "sketch"], L.lineStyle))}
        ${row(Z("f.color"), `<input type="color" name="color" value="${esc(L.color)}">`)}`)}
      ${fold("numbers", Z("grp.numbers"), "fa-solid fa-hashtag", `
        ${row(Z("f.numbers"), opts("numbers", ["always", "hover", "never"], L.numbers), Z("h.numbers"))}
        ${L.numbers !== "never" ? `${row(Z("f.place"), opts("place", ["center", "corner"], L.place))}
          ${row(Z("f.numShape"), opts("numShape", ["circle", "square", "hex", "diamond", "plain"], L.numShape))}
          ${row(Z("f.numFormat"), opts("numFormat", ["arabic", "roman", "letters"], L.numFormat))}
          ${row(Z("f.numColor"), `<input type="color" name="numColor" value="${esc(L.numColor || L.color)}">`, Z("h.numColor"))}
          ${row(Z("f.ringColor"), `<input type="color" name="ringColor" value="${esc(L.ringColor || L.color)}">`, Z("h.numColor"))}` : ""}`)}
      ${fold("hover", Z("grp.hover"), "fa-solid fa-hand-pointer", `
        ${optCheck({ name: "hoverHi", label: Z("f.hoverHi"), checked: L.hoverHi, hint: Z("h.hoverHi") })}
        ${L.hoverHi ? `${row(Z("f.hoverFx"), opts("hoverFx", ["none", "glow", "hatch", "crosshatch", "dots"], L.hoverFx))}
          ${L.hoverFx !== "none" ? row(Z("f.hoverAlpha"), range("hoverAlpha", 0, 1)) : ""}
          ${row(Z("f.hoverLineAlpha"), range("hoverLineAlpha", 0, 1))}` : ""}`)}
      </section>
      <section class="mm-wp-sec mm-z-panel"><h4>${esc(Z("sec.mine"))}</h4>
      ${optCheck({ name: "dist", label: Z("f.distances"), checked: setting("zonesDistances") !== false, hint: Z("h.distances") })}
      ${optCheck({ name: "ruler", label: Z("f.ruler"), checked: setting("zonesRuler") !== false, hint: Z("h.ruler") })}
      ${fold("world", Z("sec.world"), "fa-solid fa-earth-europe", `
        <p class="mm-ws-hint">${esc(Z("h.world"))}</p>
        ${row(Z("f.preset"), sel("worldPreset", moves, wPreset), Z("h.worldPreset"))}
        ${row(Z("f.style"), sel("worldStyle", styles.map((x) => [x.id, x.name]), world), Z("h.worldStyle"))}`)}
      </section>
      <section class="mm-wp-sec mm-z-panel mm-z-danger"><button type="button" class="mm-ws-btn mm-danger" data-act="clear"><i class="fa-solid fa-trash" inert></i> ${esc(Z("clear"))}</button></section>`;
  };
  render();
  const onChange = (ev) => {
    // only the control's own event, found by its name ATTRIBUTE (a range-picker has no name property). A range-picker's inner
    // inputs fire "change" first, unnamed and while the picker still holds the old value: they are skipped.
    const c = ev.target, name = c?.getAttribute?.("name");
    if ( !name ) return;
    const v = c.matches("input[type=checkbox]") ? c.checked : c.value;
    if ( name === "preset" ) Zones.setParams({ preset: v || null });
    else if ( name === "lookFrom" ) Zones.setParams({ lookFrom: v || null });
    else if ( name === "worldPreset" ) Styles.setWorldPreset(v);
    else if ( name === "worldStyle" ) Styles.setWorldStyle(v);
    else if ( ["fill", "ink", "lineAlpha", "hoverAlpha", "hoverLineAlpha"].includes(name) ) Zones.setParams({ look: { [name]: Number(v) } });
    else if ( ["who", "color", "numbers", "place", "hoverHi", "hoverFx", "lineStyle", "numColor", "ringColor", "numShape", "numFormat"].includes(name) ) Zones.setParams({ look: { [name]: v } });
    else return;
    // a choice that shows or hides other rows, or a look change that turned the look preset into "own": draw the panel again
    // (the "params" hook skips it while focus is in the panel)
    if ( ["lookFrom", "numbers", "hoverHi", "hoverFx", "preset"].includes(name) || c.closest(".mm-z-fold[data-fold=look], .mm-z-fold[data-fold=hover], .mm-z-fold[data-fold=numbers]") ) queueMicrotask(render);
  };
  const onClick = async (ev) => {
    const act = ev.target.closest("[data-act]")?.dataset.act;
    if ( act === "saveStyle" ) {
      const name = await foundry.applications.api.DialogV2.prompt({
        window: { title: Z("style.save") },
        content: `<label>${esc(Z("style.name"))} <input type="text" name="name" autofocus></label>`,
        ok: { callback: (_e, b) => b.form.elements.name.value }
      }).catch(() => null);
      if ( !name?.trim() ) return;
      const id = await Styles.saveStyle(name, Zones.look());
      Zones.setParams({ lookFrom: id });
      return;
    }
    if ( act === "delStyle" ) {
      const id = Zones.state()?.lookFrom;
      if ( !id?.startsWith("u-") ) return;
      const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: Z("style.delete") }, content: `<p>${esc(Z("style.deleteAsk"))}</p>` });
      if ( !ok ) return;
      // this scene keeps the look it shows, as its own
      Zones.setParams({ lookFrom: "custom" });
      await Styles.deleteStyle(id);
      return;
    }
    if ( act !== "clear" ) return;
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: Z("clear") }, content: `<p>${esc(Z("clearAsk"))}</p>` });
    if ( ok ) Zones.clearAll();
  };
  const onToggle = (ev) => { const d = ev.target; if ( d.matches?.(".mm-z-fold") ) { if ( d.open ) openFolds.add(d.dataset.fold); else openFolds.delete(d.dataset.fold); } };
  host.addEventListener("change", onChange);
  host.addEventListener("click", onClick);
  host.addEventListener("toggle", onToggle, true);
  const off = bindSettings(host, { dist: "zonesDistances", ruler: "zonesRuler" });
  const hook = Hooks.on("moinenMapsZones", (kind) => { if ( (kind === "loaded" || kind === "params") && !host.contains(document.activeElement) ) render(); });
  return () => { host.removeEventListener("change", onChange); host.removeEventListener("click", onClick); host.removeEventListener("toggle", onToggle, true); off(); Hooks.off("moinenMapsZones", hook); };
}

export function zonesSection() {
  watch();
  return {
    id: "zones", order: 6, title: "MOINENMAPS.WS.zones", icon: "fa-solid fa-vector-square", color: "#f3e7c9",
    activeTool: "mm-z-draw",
    tools: () => [
      { name: "mm-z-pick", order: 1, title: "MOINENMAPS.Zones.tool.pick", icon: "fa-solid fa-arrow-pointer" },
      { name: "mm-z-draw", order: 2, title: "MOINENMAPS.Zones.tool.draw", icon: "fa-solid fa-pencil", color: "#f3e7c9" },
      { name: "mm-z-erase", order: 3, title: "MOINENMAPS.Zones.tool.erase", icon: "fa-solid fa-eraser", color: "#ffffff" },
      { name: "mm-z-trim", order: 10, title: "MOINENMAPS.Zones.trimHint", icon: "fa-solid fa-scissors", button: true, onClick: () => Zones.trim() }
    ],
    onToolChange: (tool, active) => { if ( tool in TOOLS ) Editor.setMode(active ? TOOLS[tool] : null); },
    bar,
    panels: [
      { id: "settings", title: "MOINENMAPS.Zones.sec.settings", icon: "fa-solid fa-person-running", mount: (host) => settingsPanel(host) }
    ]
  };
}

registerSection(zonesSection());
