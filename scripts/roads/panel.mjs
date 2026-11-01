import { MODULE_ID } from "../config.mjs";
import * as Model from "./model.mjs";
import * as Roads from "./roads.mjs";
import * as Editor from "./editor.mjs";
import { kindSwatch } from "./art.mjs";
import * as Graph from "./graph.mjs";
import { writeControl, isEcho } from "../workspace/ui.mjs";

/**
 * The roads' controls, in three sections that can be mounted into any element: "brush" (the tool, road kind, width, lanes,
 * one-way; fits an options bar), "traffic" and "look" (fit a dock panel). The roads window shows all three. Every change
 * applies at once; the scene is saved a moment later.
 */

const T = (k) => game.i18n.localize(`MOINENMAPS.Roads.${k}`);
const F = (k, d) => game.i18n.format(`MOINENMAPS.Roads.${k}`, d);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
let uid = 0;

/* ---------------------------------------------------------------- markup */

function row(id, name, control, hintKey = name) {
  const hint = game.i18n.has(`MOINENMAPS.Roads.h.${hintKey}`) ? T(`h.${hintKey}`) : "";
  return `<div class="mm-wp-row"><label for="${id}"${hint ? ` data-tooltip="${esc(hint)}"` : ""}>${esc(T(`f.${name}`))}</label><div class="mm-wp-ctl">${control}</div></div>`;
}

const range = (id, name, min, max, step, value) => `<range-picker id="${id}" name="${name}" min="${min}" max="${max}" step="${step}" value="${value}"></range-picker>`;
const check = (id, name, on) => `<input type="checkbox" id="${id}" name="${name}"${on ? " checked" : ""}>`;
const select = (id, name, opts, value, prefix) => `<select id="${id}" name="${name}">${opts.map((o) => `<option value="${o}"${String(value) === String(o) ? " selected" : ""}>${esc(T(`${prefix}.${o}`))}</option>`).join("")}</select>`;

function brushHtml(p) {
  const b = Roads.brush(), m = Editor.mode();
  const kinds = Model.KINDS.slice().reverse().map((k) => `<button type="button" class="mm-rd-kind" data-kind="${k}" aria-pressed="${b.k === k}" data-tooltip="${esc(T(`kinds.${k}`))}">
      <img src="${kindSwatch(k)}" alt="" inert><span>${esc(T(`kinds.${k}`))}</span></button>`).join("");
  return `<section class="mm-wp-sec mm-rd-brush"><h4>${esc(T("sec.brush"))}</h4>
    <div class="mm-rd-tools" role="group" aria-label="${esc(T("f.tool"))}">
      <button type="button" data-mode="draw" aria-pressed="${m === "draw"}"><i class="fa-solid fa-road" inert></i> ${esc(T("mode.draw"))}</button>
      <button type="button" data-mode="erase" aria-pressed="${m === "erase"}"><i class="fa-solid fa-eraser" inert></i> ${esc(T("mode.erase"))}</button>
      <button type="button" data-mode="edit" aria-pressed="${m === "edit"}"><i class="fa-solid fa-bezier-curve" inert></i> ${esc(T("mode.edit"))}</button>
      <button type="button" data-act="undo" data-tooltip="${esc(T("undo"))}" aria-label="${esc(T("undo"))}"${Roads.canUndo() ? "" : " disabled"}><i class="fa-solid fa-rotate-left" inert></i></button>
      <button type="button" data-act="redo" data-tooltip="${esc(T("redo"))}" aria-label="${esc(T("redo"))}"${Roads.canRedo() ? "" : " disabled"}><i class="fa-solid fa-rotate-right" inert></i></button>
    </div>
    <div class="mm-rd-kinds" role="radiogroup" aria-label="${esc(T("f.kind"))}">${kinds}</div>
    ${row(`${p}-w`, "width", range(`${p}-w`, "w", 0.05, 3, 0.05, b.w))}
    ${row(`${p}-l`, "lanes", select(`${p}-l`, "l", [2, 1], b.l, "o.lanes"))}
    ${row(`${p}-o`, "oneway", check(`${p}-o`, "o", b.o))}
    ${row(`${p}-eraser`, "eraser", range(`${p}-eraser`, "eraser", 0.15, 4, 0.05, b.eraser))}
    <p class="hint mm-rd-hint" aria-live="polite">${esc(T(hintKey(m)))}</p></section>`;
}

/** The brush on one line, for a host's options bar (the workspace's bar classes: mm-ws-opt, mm-ws-btn, mm-ws-hint). */
const hintKey = (m, short = false) => `${m === "erase" ? "hintErase" : m === "edit" ? "hintEdit" : "hintDraw"}${short ? "Short" : ""}`;

/** The options bar of the edit tool: the selected road's own kind, width, lanes, one-way and speed. */
function editBarHtml(p) {
  const id = Editor.selectedEdge(), e = id != null ? Roads.state()?.G.edges.get(id) : null;
  const undo = `<button type="button" class="mm-ws-btn" data-act="undo" aria-label="${esc(T("undo"))}" data-tooltip="${esc(T("undo"))}"${Roads.canUndo() ? "" : " disabled"}><i class="fa-solid fa-rotate-left" inert></i></button>
    <button type="button" class="mm-ws-btn" data-act="redo" aria-label="${esc(T("redo"))}" data-tooltip="${esc(T("redo"))}"${Roads.canRedo() ? "" : " disabled"}><i class="fa-solid fa-rotate-right" inert></i></button>`;
  if ( !e ) return `<div class="mm-rd-bar">${undo}<span class="mm-ws-hint">${esc(T("editPick"))}</span></div>`;
  const kinds = Model.KINDS.slice().reverse().map((k) => `<button type="button" class="mm-rd-kind mm-rd-kind-sm" data-rkind="${k}" aria-pressed="${e.k === k}" aria-label="${esc(T(`kinds.${k}`))}" data-tooltip="${esc(T(`kinds.${k}`))}"><img src="${kindSwatch(k, 40, 16)}" alt="" inert></button>`).join("");
  const opt = (id2, name, ctl) => `<div class="mm-ws-opt mm-ws-range"><label for="${id2}" data-tooltip="${esc(game.i18n.has(`MOINENMAPS.Roads.h.${name}`) ? T(`h.${name}`) : "")}">${esc(T(`f.${name}`))}</label>${ctl}</div>`;
  return `<div class="mm-rd-bar" data-road="${e.id}"><div class="mm-rd-kinds mm-rd-kinds-bar" role="radiogroup" aria-label="${esc(T("f.kind"))}">${kinds}</div>
    ${opt(`${p}-rw`, "width", range(`${p}-rw`, "rw", 0.05, 3, 0.05, e.w))}
    <div class="mm-ws-opt"><label for="${p}-rl">${esc(T("f.lanes"))}</label>${select(`${p}-rl`, "rl", [2, 1], e.l, "o.lanes")}</div>
    <label class="mm-ws-opt mm-ws-check" data-tooltip="${esc(T("h.oneway"))}"><input type="checkbox" name="ro"${e.o ? " checked" : ""}> <span>${esc(T("f.oneway"))}</span></label>
    ${opt(`${p}-rsp`, "roadSpeed", range(`${p}-rsp`, "rsp", 0.2, 2, 0.1, e.sp ?? 1))}
    <button type="button" class="mm-ws-btn" data-act="reverse" data-tooltip="${esc(T("reverse"))}" aria-label="${esc(T("reverse"))}"><i class="fa-solid fa-arrows-left-right" inert></i></button>
    <button type="button" class="mm-ws-btn mm-danger" data-act="delroad" data-tooltip="${esc(T("deleteRoad"))}" aria-label="${esc(T("deleteRoad"))}"><i class="fa-solid fa-trash" inert></i></button>
    ${undo}<span class="mm-ws-hint mm-rd-hint" data-short="1">${esc(T("hintEditShort"))}</span></div>`;
}

function barHtml(p) {
  const b = Roads.brush(), m = Editor.mode();
  if ( m === "edit" ) return editBarHtml(p);
  const kinds = Model.KINDS.slice().reverse().map((k) => `<button type="button" class="mm-rd-kind mm-rd-kind-sm" data-kind="${k}" aria-pressed="${b.k === k}" aria-label="${esc(T(`kinds.${k}`))}" data-tooltip="${esc(T(`kinds.${k}`))}"><img src="${kindSwatch(k, 40, 16)}" alt="" inert></button>`).join("");
  const opt = (id, name, ctl) => `<div class="mm-ws-opt mm-ws-range"><label for="${id}" data-tooltip="${esc(game.i18n.has(`MOINENMAPS.Roads.h.${name}`) ? T(`h.${name}`) : "")}">${esc(T(`f.${name}`))}</label>${ctl}</div>`;
  const size = m === "erase"
    ? opt(`${p}-eraser`, "eraser", range(`${p}-eraser`, "eraser", 0.15, 4, 0.05, b.eraser))
    : `<div class="mm-rd-kinds mm-rd-kinds-bar" role="radiogroup" aria-label="${esc(T("f.kind"))}">${kinds}</div>
       ${opt(`${p}-w`, "width", range(`${p}-w`, "w", 0.05, 3, 0.05, b.w))}
       <div class="mm-ws-opt"><label for="${p}-l">${esc(T("f.lanes"))}</label>${select(`${p}-l`, "l", [2, 1], b.l, "o.lanes")}</div>
       <label class="mm-ws-opt mm-ws-check" data-tooltip="${esc(T("h.oneway"))}"><input type="checkbox" name="o"${b.o ? " checked" : ""}> <span>${esc(T("f.oneway"))}</span></label>`;
  return `<div class="mm-rd-bar">${size}
    <button type="button" class="mm-ws-btn" data-act="undo" aria-label="${esc(T("undo"))}" data-tooltip="${esc(T("undo"))}"${Roads.canUndo() ? "" : " disabled"}><i class="fa-solid fa-rotate-left" inert></i></button>
    <button type="button" class="mm-ws-btn" data-act="redo" aria-label="${esc(T("redo"))}" data-tooltip="${esc(T("redo"))}"${Roads.canRedo() ? "" : " disabled"}><i class="fa-solid fa-rotate-right" inert></i></button>
    <span class="mm-ws-hint mm-rd-hint" data-short="1">${esc(T(hintKey(m, true)))}</span></div>`;
}

function trafficHtml(p) {
  const R = Roads.state(), t = R?.traffic ?? Model.cleanTraffic();
  const types = Model.BODY_TYPES.map((k) => `<label class="mm-rd-chip"><input type="checkbox" name="kind:${k}"${t.kinds.includes(k) ? " checked" : ""}><span>${esc(T(`types.${k}`))}</span></label>`).join("");
  return `<section class="mm-wp-sec mm-rd-traffic"><h4>${esc(T("sec.traffic"))}</h4>
    ${row(`${p}-on`, "on", check(`${p}-on`, "on", t.on))}
    ${row(`${p}-density`, "density", range(`${p}-density`, "density", 0, 100, 5, Math.round(t.density * 100)))}
    ${row(`${p}-speed`, "speed", range(`${p}-speed`, "speed", 0.2, 3, 0.1, t.speed))}
    ${row(`${p}-size`, "size", range(`${p}-size`, "size", 0.03, 1.5, 0.01, t.size))}
    ${row(`${p}-vary`, "vary", range(`${p}-vary`, "vary", 0, 50, 5, Math.round((t.vary ?? 0) * 100)))}
    ${row(`${p}-max`, "max", range(`${p}-max`, "max", 0, 150, 5, t.max))}
    <div class="mm-rd-types" role="group" aria-label="${esc(T("f.types"))}"><span class="mm-rd-types-label">${esc(T("f.types"))}</span>${types}</div>
    ${row(`${p}-side`, "side", select(`${p}-side`, "side", ["right", "left"], t.side, "o.side"))}
    ${row(`${p}-lights`, "lights", select(`${p}-lights`, "lights", ["auto", "on", "off"], t.lights, "o.lights"))}
    ${row(`${p}-who`, "who", select(`${p}-who`, "who", ["all", "gm"], t.who, "o.who"))}
    ${row(`${p}-style`, "style", select(`${p}-style`, "style", ["ink", "pixel"], t.style, "o.style"))}
    <div class="mm-rd-btns"><button type="button" data-act="shuffle"><i class="fa-solid fa-shuffle" inert></i> ${esc(T("shuffle"))}</button></div></section>`;
}

function lookHtml(p) {
  const R = Roads.state(), l = R?.look ?? Model.cleanLook();
  return `<section class="mm-wp-sec mm-rd-look"><h4>${esc(T("sec.look"))}</h4>
    ${row(`${p}-shadow`, "shadow", range(`${p}-shadow`, "shadow", 0, 100, 5, Math.round(l.shadow * 100)))}
    ${row(`${p}-ink`, "ink", range(`${p}-ink`, "ink", 0, 3, 0.1, l.ink))}
    ${row(`${p}-marks`, "marks", check(`${p}-marks`, "marks", l.marks))}
    ${row(`${p}-crossings`, "crossings", check(`${p}-crossings`, "crossings", l.crossings))}
    ${row(`${p}-guides`, "guides", select(`${p}-guides`, "guides", ["tool", "always"], l.guides, "o.guides"))}
    <div class="mm-rd-btns"><button type="button" data-act="clear" class="mm-danger"><i class="fa-solid fa-trash" inert></i> ${esc(T("clear"))}</button></div></section>`;
}

const statusText = () => { const s = Roads.stats(); return F("status", { roads: s.roads, junctions: s.junctions, cars: s.cars }); };

/* ---------------------------------------------------------------- mounting */

/**
 * Render sections ("brush", "traffic", "look") into `host` and keep them in step with the roads.
 * Returns { refresh(), destroy() }.
 */
export function mountRoadControls(host, sections = ["brush", "traffic", "look"], { status = true, headings = true } = {}) {
  const p = `mm-rd-${++uid}`;
  const html = () => (status ? `<div class="mm-wp-status mm-rd-status" role="status" aria-live="polite">${esc(statusText())}</div>` : "")
    + (game.user.isGM ? sections.map((s) => s === "bar" ? barHtml(p) : s === "brush" ? brushHtml(p) : s === "traffic" ? trafficHtml(p) : s === "look" ? lookHtml(p) : "").join("") : `<p class="hint">${esc(T("gmOnly"))}</p>`);
  host.classList.add("mm-rd"); host.classList.toggle("mm-rd-noheads", !headings);
  host.innerHTML = html();
  const onClick = async (ev) => {
    const b = ev.target.closest("button"); if ( !b || !host.contains(b) ) return;
    const road = b.closest("[data-road]")?.dataset.road;
    if ( b.dataset.rkind && road ) { Roads.setRoad(Number(road), { k: b.dataset.rkind }); return; }
    if ( b.dataset.act === "reverse" && road ) { Roads.edit((G) => Graph.reverseEdge(G, Number(road))); return; }
    if ( b.dataset.act === "delroad" && road ) { Roads.edit((G) => Graph.removeEdge(G, Number(road), Roads.gridSize())); return; }
    if ( b.dataset.kind ) { Roads.setBrush({ k: b.dataset.kind }); if ( !Editor.mode() ) Editor.setMode("draw"); return; }
    if ( b.dataset.mode ) { Editor.setMode(Editor.mode() === b.dataset.mode ? null : b.dataset.mode); return; }
    const act = b.dataset.act;
    if ( act === "undo" ) Roads.undoEdit();
    else if ( act === "redo" ) Roads.redoEdit();
    else if ( act === "shuffle" ) Roads.shuffleTraffic();
    else if ( act === "clear" ) {
      const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: T("clear") }, content: `<p>${esc(T("clearConfirm"))}</p>`, rejectClose: false });
      if ( ok ) Roads.clearRoads();
    }
  };
  const onInput = (ev) => {
    if ( isEcho() ) return;     // sync() writing the state back into a control is not an edit
    const el = ev.target.closest?.("[name]"); if ( !el || !host.contains(el) ) return;
    const name = el.name, v = el.type === "checkbox" ? el.checked : el.value;
    const road = el.closest("[data-road]")?.dataset.road;
    if ( road && ["rw", "rl", "ro", "rsp"].includes(name) ) {
      const key = { rw: "w", rl: "l", ro: "o", rsp: "sp" }[name];
      return Roads.setRoad(Number(road), { [key]: name === "ro" ? !!v : Number(v) });
    }
    if ( name === "vary" ) return Roads.setTraffic({ vary: Number(v) / 100 });
    if ( ["w", "l", "o", "eraser"].includes(name) ) return Roads.setBrush({ [name]: name === "o" ? !!v : Number(v) });
    if ( name.startsWith("kind:") ) {
      const kinds = Model.BODY_TYPES.filter((k) => host.querySelector(`[name="kind:${k}"]`)?.checked);
      return Roads.setTraffic({ kinds });
    }
    if ( ["density", "shadow"].includes(name) ) return (name === "density" ? Roads.setTraffic : Roads.setLook)({ [name]: Number(v) / 100 });
    if ( ["speed", "size", "max"].includes(name) ) return Roads.setTraffic({ [name]: Number(v) });
    if ( ["on"].includes(name) ) return Roads.setTraffic({ on: !!v });
    if ( ["side", "lights", "who", "style"].includes(name) ) return Roads.setTraffic({ [name]: String(v) });
    if ( name === "ink" ) return Roads.setLook({ ink: Number(v) });
    if ( ["marks", "crossings"].includes(name) ) return Roads.setLook({ [name]: !!v });
    if ( name === "guides" ) return Roads.setLook({ guides: String(v) });
  };
  // a range-picker reports while dragging ("input"); everything else on change
  host.addEventListener("click", onClick);
  host.addEventListener("change", onInput);
  const refresh = () => sync(host);
  // the bar is rebuilt when the tool or (edit tool) the selected road changes; everything else updates in place
  const rebuild = (kind) => kind === "loaded" || (sections.includes("bar") && (kind === "mode" || kind === "select" || (kind === "edited" && Editor.mode() === "edit")));
  const hook = (kind) => { if ( rebuild(kind) ) host.innerHTML = html(); else refresh(); };
  Hooks.on("moinenMapsRoads", hook);
  const timer = setInterval(() => { const s = host.querySelector(".mm-rd-status"); if ( s ) s.textContent = statusText(); }, 1000);
  return {
    refresh,
    destroy() { Hooks.off("moinenMapsRoads", hook); clearInterval(timer); host.removeEventListener("click", onClick); host.removeEventListener("change", onInput); host.innerHTML = ""; host.classList.remove("mm-rd", "mm-rd-noheads"); }
  };
}

/** Bring the controls in line with the current state without re-rendering (a control being used keeps its focus). */
function sync(host) {
  const R = Roads.state(), b = Roads.brush(), m = Editor.mode();
  const t = R?.traffic, l = R?.look;
  const set = (name, v) => {
    const el = host.querySelector(`[name="${CSS.escape(name)}"]`); if ( !el || el.contains(document.activeElement) || el === document.activeElement ) return;
    writeControl(el, v);     // silent: a <range-picker> reports every value set from code as a change
  };
  set("w", b.w); set("l", b.l); set("o", b.o); set("eraser", b.eraser);
  host.querySelectorAll("[data-kind]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.kind === b.k)));
  host.querySelectorAll("[data-mode]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.mode === m)));
  host.querySelectorAll(".mm-rd-hint").forEach((h) => { h.textContent = T(hintKey(m, !!h.dataset.short)); });
  const u = host.querySelector('[data-act="undo"]'), r = host.querySelector('[data-act="redo"]');
  if ( u ) u.disabled = !Roads.canUndo(); if ( r ) r.disabled = !Roads.canRedo();
  if ( t ) {
    set("on", t.on); set("density", Math.round(t.density * 100)); set("speed", t.speed); set("size", t.size); set("vary", Math.round((t.vary ?? 0) * 100)); set("max", t.max);
    set("side", t.side); set("lights", t.lights); set("who", t.who); set("style", t.style);
    for ( const k of Model.BODY_TYPES ) set(`kind:${k}`, t.kinds.includes(k));
  }
  if ( l ) { set("shadow", Math.round(l.shadow * 100)); set("ink", l.ink); set("marks", l.marks); set("crossings", l.crossings); set("guides", l.guides); }
  const s = host.querySelector(".mm-rd-status"); if ( s ) s.textContent = statusText();
}

/* ---------------------------------------------------------------- the window */

let panel = null;

export function openRoadsPanel() {
  if ( panel?.rendered ) { panel.bringToFront?.(); return panel; }
  panel = new RoadsPanel();
  panel.render({ force: true });
  return panel;
}

class RoadsPanel extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "moinen-maps-roads", tag: "div", classes: ["moinen-maps-dialog", "mm-roads-panel"],
    window: { icon: "fa-solid fa-road", resizable: true }, position: { width: 400, height: 720 }
  };

  #mount = null;

  get title() { return T("title"); }

  async _renderHTML() { return ""; }

  _replaceHTML(_result, content) {
    if ( this.#mount ) return;
    const body = document.createElement("div");
    body.className = "mm-wp-body mm-rd-body";
    content.classList.add("mm-wp");
    content.append(body);
    this.#mount = mountRoadControls(body, ["brush", "traffic", "look"]);
  }

  _onClose() { this.#mount?.destroy(); this.#mount = null; panel = null; }
}

export { MODULE_ID };
