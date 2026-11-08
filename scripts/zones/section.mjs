import { registerSection } from "../workspace/registry.mjs";
import { esc, T, setting, optRange, optCheck, optHint, bindSettings } from "../workspace/ui.mjs";
import * as Zones from "./zones.mjs";
import * as Editor from "./editor.mjs";
import { presets } from "./presets.mjs";

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
    const c = ev.target.closest?.("[name=snap], [name=smooth]"); if ( !c ) return;
    Zones.setParams({ [c.name]: Number(c.value) });
  };
  host.addEventListener("click", onClick);
  host.addEventListener("change", onChange);
  const off = bindSettings(host, { eraser: { key: "zonesEraser", read: (c) => Math.min(4, Math.max(0.1, Number(c.value) || 0.5)) } });
  // the counts and undo buttons follow every edit (re-rendered unless a slider is in hand)
  const hook = Hooks.on("moinenMapsZones", (kind) => { if ( kind === "edited" || kind === "loaded" ) { if ( !host.contains(document.activeElement) ) render(); else host.querySelector(".mm-z-status")?.replaceChildren(statusText()); } });
  return () => { host.removeEventListener("click", onClick); host.removeEventListener("change", onChange); off(); Hooks.off("moinenMapsZones", hook); };
}

/** The scene's zone settings (preset, who sees them, look) and this user's own (distances, ruler). */
function settingsPanel(host) {
  const render = () => {
    const S = Zones.state(); if ( !S ) { host.innerHTML = `<p class="hint">${esc(Z("noScene"))}</p>`; return; }
    const L = S.look;
    const row = (label, ctl, hint = "") => `<div class="mm-wp-row"><label${hint ? ` data-tooltip="${esc(hint)}"` : ""}>${esc(label)}</label><div class="mm-wp-ctl">${ctl}</div></div>`;
    const sel = (name, opts, v) => `<select name="${name}">${opts.map(([k, l]) => `<option value="${esc(k)}"${k === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    host.innerHTML = `<section class="mm-wp-sec">
      ${row(Z("f.preset"), sel("preset", presets().map((p) => [p.id, game.i18n.localize(p.title)]), S.preset), Z("h.preset"))}
      <p class="hint">${esc(Z(`presetInfo.${S.preset}`))}</p>
      ${row(Z("f.who"), sel("who", [["all", Z("who.all")], ["gm", Z("who.gm")], ["none", Z("who.none")]], L.who), Z("h.who"))}
      ${row(Z("f.fill"), `<range-picker name="fill" min="0" max="1" step="0.05" value="${L.fill}"></range-picker>`)}
      ${row(Z("f.ink"), `<range-picker name="ink" min="0" max="2" step="0.05" value="${L.ink}"></range-picker>`)}
      ${row(Z("f.color"), `<input type="color" name="color" value="${esc(L.color)}">`)}
      ${row(Z("f.hoverHi"), `<input type="checkbox" name="hoverHi"${L.hoverHi ? " checked" : ""}>`, Z("h.hoverHi"))}
      ${row(Z("f.hoverFx"), sel("hoverFx", ["none", "glow", "hatch", "crosshatch", "dots"].map((k) => [k, Z(`hoverFx.${k}`)]), L.hoverFx))}
      ${row(Z("f.place"), sel("place", [["center", Z("place.center")], ["corner", Z("place.corner")]], L.place))}
      ${row(Z("f.numbers"), sel("numbers", [["always", Z("numbers.always")], ["hover", Z("numbers.hover")], ["never", Z("numbers.never")]], L.numbers), Z("h.numbers"))}
      </section><section class="mm-wp-sec"><h4>${esc(Z("sec.mine"))}</h4>
      ${optCheck({ name: "dist", label: Z("f.distances"), checked: setting("zonesDistances") !== false, hint: Z("h.distances") })}
      ${optCheck({ name: "ruler", label: Z("f.ruler"), checked: setting("zonesRuler") !== false, hint: Z("h.ruler") })}
      </section><section class="mm-wp-sec"><button type="button" class="mm-ws-btn mm-danger" data-act="clear"><i class="fa-solid fa-trash" inert></i> ${esc(Z("clear"))}</button></section>`;
  };
  render();
  const onChange = (ev) => {
    const c = ev.target.closest?.("[name]"); if ( !c ) return;
    const v = c.matches("input[type=checkbox]") ? c.checked : c.value;
    if ( c.name === "preset" ) Zones.setParams({ preset: v });
    else if ( ["who", "color", "numbers", "place", "hoverHi", "hoverFx"].includes(c.name) ) Zones.setParams({ look: { [c.name]: v } });
    else if ( ["fill", "ink"].includes(c.name) ) Zones.setParams({ look: { [c.name]: Number(v) } });
  };
  const onClick = async (ev) => {
    if ( !ev.target.closest("[data-act=clear]") ) return;
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: Z("clear") }, content: `<p>${esc(Z("clearAsk"))}</p>` });
    if ( ok ) Zones.clearAll();
  };
  host.addEventListener("change", onChange);
  host.addEventListener("click", onClick);
  const off = bindSettings(host, { dist: "zonesDistances", ruler: "zonesRuler" });
  const hook = Hooks.on("moinenMapsZones", (kind) => { if ( (kind === "loaded" || kind === "params") && !host.contains(document.activeElement) ) render(); });
  return () => { host.removeEventListener("change", onChange); host.removeEventListener("click", onClick); off(); Hooks.off("moinenMapsZones", hook); };
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
