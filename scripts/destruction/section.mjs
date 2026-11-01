import { registerSection } from "../workspace/registry.mjs";
import { esc, T, optRange, optSelect, optCheck, optHint } from "../workspace/ui.mjs";
import { MODULE_ID } from "../config.mjs";
import * as Model from "./model.mjs";
import * as Editor from "./editor.mjs";
import * as D from "./destruction.mjs";

/**
 * Destruction as a workspace section (takes over the "destruction" placeholder of workspace/soon.mjs).
 *  - bar: a hand (the map as usual), the damage brush and the eraser; the brush's options are its size, its level (cracked, broken,
 *    crater) and the kind of damage; Detonate replays the break for everyone.
 *  - dock: Damage (what the bake found: each area's kind and the surface it tore up, the bake state, variation, clear),
 *    Look (how much debris, how far it flies, how it heaves, rubble, halo, ragged edge, the surface underneath) and Motion.
 */
const TOOLS = { "mm-d-pick": null, "mm-d-paint": "paint", "mm-d-erase": "erase" };
const TYPE_ICON = { blast: "fa-solid fa-explosion", collapse: "fa-solid fa-hill-rockslide", scorch: "fa-solid fa-fire", flood: "fa-solid fa-water", cracks: "fa-solid fa-burst", gash: "fa-solid fa-paw" };
const LEVEL_COLOR = ["", "#f2c14e", "#ef8a3a", "#e0453a"];

/**
 * Kill switch, per browser: localStorage "mm-destruction" = "off" leaves the feature out entirely (no hooks, no section; the
 * placeholder stays). Default: on.
 */
const OFF = (() => { try { return globalThis.localStorage?.getItem("mm-destruction") === "off"; } catch { return false; } })();

// the engine's hooks and API come with the section: importing this file (workspace/sections.mjs) is the whole wiring
if ( !OFF ) D.registerDestruction();

/**
 * Write a value into a control WITHOUT it reporting a change: Foundry's <range-picker> dispatches "change" whenever its value is set
 * from code (even to the same value). Echoing a stored value back into a control must never look like the user's edit, or
 * control -> setting -> hook -> control loops forever (this froze the whole client once).
 */
let echoing = 0;
function writeControl(c, v) {
  if ( c.matches("input[type=checkbox]") ) { if ( c.checked !== !!v ) c.checked = !!v; return; }
  if ( String(c.value) === String(v) || Number(c.value) === Number(v) ) return;
  echoing++;
  try { c.value = v; } finally { echoing--; }
}

/** Wire controls named after scene params to the engine (sliders commit on release, checkboxes and selects at once). */
function bindParams(host) {
  const read = (c) => c.matches("input[type=checkbox]") ? c.checked : c.matches("range-picker, input[type=number]") ? Number(c.value) : c.value;
  const onChange = (ev) => {
    if ( echoing ) return;
    const c = ev.target.closest?.("[name]"); if ( !c?.name?.startsWith("p.") ) return;
    D.setParams({ [c.name.slice(2)]: read(c) });
  };
  host.addEventListener("change", onChange);
  const id = Hooks.on("moinenMapsDestruction", (kind) => {
    if ( kind !== "loaded" && kind !== "params" ) return;
    const P = D.state()?.params ?? Model.PARAM_DEFAULTS;
    for ( const c of host.querySelectorAll("[name^='p.']") ) {
      if ( c.contains(document.activeElement) ) continue;
      writeControl(c, P[c.name.slice(2)]);
    }
  });
  return () => { host.removeEventListener("change", onChange); Hooks.off("moinenMapsDestruction", id); };
}

/* ---------------------------------------------------------------- the bar */

function bar(host, ctx) {
  const mode = TOOLS[ctx.tool];
  const P0 = () => D.state()?.params ?? Model.PARAM_DEFAULTS;
  const quick = (k, icon, label) => `<button type="button" class="mm-ws-toolbtn" data-quick="${k}" aria-pressed="${!!P0()[k]}" aria-label="${esc(T(label))}" data-tooltip="${esc(T(label))}"><i class="${icon}" inert></i></button>`;
  if ( !mode ) { host.innerHTML = optHint(T("Destr.pickHint")); return; }
  const b = Editor.brush();
  const size = optRange({ name: "size", label: T("Destr.size"), value: b.size, min: 0.25, max: 10, step: 0.25, hint: T("Destr.sizeHint") });
  if ( mode === "erase" ) { host.innerHTML = `${size}${optHint(T("Destr.eraseHint"))}`; }
  else {
    const levels = Model.LEVELS.map((l) => `<button type="button" class="mm-ws-toolbtn mm-d-level" data-level="${l}" aria-pressed="${l === b.level}" style="--mm-tool:${LEVEL_COLOR[l]}" data-tooltip="${esc(T(`Destr.levelHint${l}`))}"><span class="mm-d-dot" inert></span><span>${esc(T(`Destr.level${l}`))}</span></button>`).join("");
    const types = Model.TYPES.map((t, i) => `<button type="button" class="mm-ws-toolbtn" data-type="${i}" aria-pressed="${i === b.type}" aria-label="${esc(T(`Destr.type.${t}`))}" data-tooltip="${esc(`${T(`Destr.type.${t}`)}: ${T(`Destr.typeHint.${t}`)}`)}"><i class="${TYPE_ICON[t]}" inert></i></button>`).join("");
    host.innerHTML = `${size}
      <div class="mm-ws-opt"><span class="mm-ws-label">${esc(T("Destr.level"))}</span><div class="mm-ws-tools mm-d-levels" role="group" aria-label="${esc(T("Destr.level"))}">${levels}</div></div>
      <div class="mm-ws-opt"><span class="mm-ws-label">${esc(T("Destr.kind"))}</span><div class="mm-ws-tools" role="group" aria-label="${esc(T("Destr.kind"))}">${types}</div></div>
      <div class="mm-ws-opt"><div class="mm-ws-tools" role="group">${quick("jagged", "fa-solid fa-wave-square", "Destr.quickJagged")}${quick("directional", "fa-solid fa-route", "Destr.quickDirectional")}</div></div>
      ${optHint(T("Destr.paintHint"))}`;
  }
  const onClick = (ev) => {
    const lb = ev.target.closest("[data-level]"), tb = ev.target.closest("[data-type]"), qb = ev.target.closest("[data-quick]");
    if ( qb ) D.setParams({ [qb.dataset.quick]: !P0()[qb.dataset.quick] });
    if ( lb && Number(lb.dataset.level) !== Editor.brush().level ) game.settings.set(MODULE_ID, "destrLevel", Number(lb.dataset.level));
    if ( tb && Number(tb.dataset.type) !== Editor.brush().type ) game.settings.set(MODULE_ID, "destrType", Number(tb.dataset.type));
  };
  const onChange = (ev) => {
    if ( echoing ) return;
    const c = ev.target.closest?.("[name=size]"); if ( !c ) return;
    const v = Math.min(10, Math.max(0.25, Number(c.value) || 1.5));
    if ( v !== Editor.brush().size ) game.settings.set(MODULE_ID, "destrBrush", v);
  };
  host.addEventListener("click", onClick); host.addEventListener("change", onChange);
  const id = Hooks.on("moinenMapsDestruction", (kind) => {
    if ( kind === "params" || kind === "loaded" ) { for ( const x of host.querySelectorAll("[data-quick]") ) x.setAttribute("aria-pressed", String(!!P0()[x.dataset.quick])); return; }
    if ( kind !== "brush" ) return;
    const nb = Editor.brush();
    for ( const x of host.querySelectorAll("[data-level]") ) x.setAttribute("aria-pressed", String(Number(x.dataset.level) === nb.level));
    for ( const x of host.querySelectorAll("[data-type]") ) x.setAttribute("aria-pressed", String(Number(x.dataset.type) === nb.type));
    const s = host.querySelector("[name=size]"); if ( s && !s.contains(document.activeElement) ) writeControl(s, nb.size);
  });
  return () => { host.removeEventListener("click", onClick); host.removeEventListener("change", onChange); Hooks.off("moinenMapsDestruction", id); };
}

/* ---------------------------------------------------------------- the dock */

function statusLine() {
  const st = D.getStatus(), S = D.state();
  if ( !S || !Model.hasPaint(S) ) return T("Destr.empty");
  if ( st.error ) return `${T("Destr.error")}: ${st.error}`;
  if ( st.baking ) return game.i18n.format("MOINENMAPS.Destr.baking", { pct: Math.round(st.progress * 100) });
  if ( st.waiting ) return T("Destr.waiting");
  const n = st.stats;
  const parts = [game.i18n.format("MOINENMAPS.Destr.areas", { n: st.areas.length })];
  if ( n ) parts.push(game.i18n.format("MOINENMAPS.Destr.pieces", { n: n.shards }));
  parts.push(T(`Destr.src.${st.source || "baked"}`));
  if ( S.baked?.key && st.key === S.baked.key ) parts.push(T("Destr.published"));
  return parts.join(" · ");
}

function mountDamage(host) {
  const render = () => {
    const st = D.getStatus(), S = D.state();
    const areas = st.areas.map((a, i) => `<li><i class="${TYPE_ICON[a.type] ?? TYPE_ICON.blast}" inert></i><span>${esc(T(`Destr.type.${a.type}`))}</span><span class="mm-d-mat">${esc(T(`Destr.mat.${a.mat}`))}</span></li>`).join("");
    host.innerHTML = `<p class="mm-d-status" role="status">${esc(statusLine())}</p>
      ${areas ? `<ul class="mm-d-areas" aria-label="${esc(T("Destr.areasLabel"))}">${areas}</ul>` : ""}
      <div class="mm-d-actions">
        <button type="button" class="mm-ws-btn" data-act="detonate"${S && Model.hasPaint(S) ? "" : " disabled"}><i class="fa-solid fa-explosion" inert></i> ${esc(T("Destr.detonate"))}</button>
        <button type="button" class="mm-ws-btn" data-act="variation"${S && Model.hasPaint(S) ? "" : " disabled"} data-tooltip="${esc(T("Destr.variationHint"))}"><i class="fa-solid fa-dice" inert></i> ${esc(T("Destr.variation"))}</button>
        <button type="button" class="mm-ws-btn" data-act="clear"${S && Model.hasPaint(S) ? "" : " disabled"}><i class="fa-solid fa-trash" inert></i> ${esc(T("Destr.clear"))}</button>
      </div>
      ${optCheck({ name: "enabled", label: T("Destr.enabled"), checked: S ? S.enabled : true, hint: T("Destr.enabledHint") })}`;
  };
  render();
  const onClick = async (ev) => {
    const b = ev.target.closest("[data-act]"); if ( !b ) return;
    b.blur();   // the button must not keep the keyboard (Ctrl+Z right after Detonate undoes the last stroke)
    if ( b.dataset.act === "detonate" ) D.detonate();
    else if ( b.dataset.act === "variation" ) D.newVariation();
    else if ( b.dataset.act === "clear" ) {
      const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: T("Destr.clear") }, content: `<p>${esc(T("Destr.clearConfirm"))}</p>` });
      if ( ok ) D.clearAll();
    }
  };
  const onChange = (ev) => { if ( ev.target.name === "enabled" && ev.target.checked !== (D.state()?.enabled ?? true) ) D.setEnabled(ev.target.checked); };
  host.addEventListener("click", onClick); host.addEventListener("change", onChange);
  let frame = 0;
  const id = Hooks.on("moinenMapsDestruction", () => { if ( frame ) return; frame = requestAnimationFrame(() => { frame = 0; if ( !host.contains(document.activeElement) || document.activeElement === document.body ) render(); else host.querySelector(".mm-d-status").textContent = statusLine(); }); });
  return () => { host.removeEventListener("click", onClick); host.removeEventListener("change", onChange); Hooks.off("moinenMapsDestruction", id); cancelAnimationFrame(frame); };
}

function mountLook(host) {
  const P = D.state()?.params ?? Model.PARAM_DEFAULTS, L = Model.LIMITS;
  const range = (k, step = 0.05) => optRange({ name: `p.${k}`, label: T(`Destr.f.${k}`), value: P[k], min: L[k][0], max: L[k][1], step, hint: T(`Destr.h.${k}`) });
  host.innerHTML = `<div class="mm-d-form">
    ${optSelect({ name: "p.material", label: T("Destr.f.material"), value: P.material, hint: T("Destr.h.material"), options: Model.MATERIALS.map((m) => [m, T(`Destr.mat.${m}`)]) })}
    ${range("debris")}${range("scatter")}${range("lift")}${range("rubble")}${range("halo")}${range("edge")}
    ${optCheck({ name: "p.jagged", label: T("Destr.f.jagged"), checked: P.jagged, hint: T("Destr.h.jagged") })}
    <div class="mm-d-jag"${P.jagged ? "" : " hidden"}>${range("jag")}</div>
    ${optCheck({ name: "p.directional", label: T("Destr.f.directional"), checked: P.directional, hint: T("Destr.h.directional") })}</div>`;
  // the tearing slider only while torn borders are on
  const id = Hooks.on("moinenMapsDestruction", (kind) => {
    if ( kind !== "loaded" && kind !== "params" ) return;
    const j = host.querySelector(".mm-d-jag"); if ( j ) j.hidden = !(D.state()?.params ?? Model.PARAM_DEFAULTS).jagged;
  });
  const off = bindParams(host);
  return () => { off(); Hooks.off("moinenMapsDestruction", id); };
}

function mountMotion(host) {
  const P = D.state()?.params ?? Model.PARAM_DEFAULTS;
  host.innerHTML = `<div class="mm-d-form">
    ${optCheck({ name: "p.anim", label: T("Destr.f.anim"), checked: P.anim, hint: T("Destr.h.anim") })}
    ${optCheck({ name: "p.idle", label: T("Destr.f.idle"), checked: P.idle, hint: T("Destr.h.idle") })}
    ${optSelect({ name: "p.fxWho", label: T("Destr.f.fxWho"), value: P.fxWho, options: [["all", T("Destr.o.all")], ["gm", T("Destr.o.gm")]] })}
    ${optCheck({ name: "p.entry", label: T("Destr.f.entry"), checked: P.entry, hint: T("Destr.h.entry") })}
    ${optRange({ name: "p.entrySpeed", label: T("Destr.f.entrySpeed"), value: P.entrySpeed, min: Model.LIMITS.entrySpeed[0], max: Model.LIMITS.entrySpeed[1], step: 0.1, hint: T("Destr.h.entrySpeed") })}
    ${optRange({ name: "p.entryPower", label: T("Destr.f.entryPower"), value: P.entryPower, min: Model.LIMITS.entryPower[0], max: Model.LIMITS.entryPower[1], step: 0.1, hint: T("Destr.h.entryPower") })}
    <p class="mm-ws-hint">${esc(T("Destr.motionHint"))}</p></div>`;
  return bindParams(host);
}

if ( !OFF ) registerSection({
  id: "destruction", order: 4, title: "MOINENMAPS.WS.destruction", icon: "fa-solid fa-house-crack", color: "#e0453a",
  activeTool: "mm-d-pick",
  tools: () => [
    { name: "mm-d-pick", order: 1, title: "MOINENMAPS.Destr.tool.pick", icon: "fa-solid fa-arrow-pointer" },
    { name: "mm-d-paint", order: 2, title: "MOINENMAPS.Destr.tool.paint", icon: "fa-solid fa-house-crack", color: "#ef8a3a" },
    { name: "mm-d-erase", order: 3, title: "MOINENMAPS.Destr.tool.erase", icon: "fa-solid fa-trowel-bricks", color: "#ffffff" },
    { name: "mm-d-detonate", order: 10, button: true, title: "MOINENMAPS.Destr.detonate", icon: "fa-solid fa-explosion", onClick: () => D.detonate() }
  ],
  onToolChange: (tool, active) => { if ( tool in TOOLS ) Editor.setMode(active ? TOOLS[tool] : null); },
  bar,
  panels: [
    { id: "damage", title: "MOINENMAPS.Destr.pDamage", icon: "fa-solid fa-house-crack", mount: mountDamage },
    { id: "look", title: "MOINENMAPS.Destr.pLook", icon: "fa-solid fa-sliders", mount: mountLook },
    { id: "motion", title: "MOINENMAPS.Destr.pMotion", icon: "fa-solid fa-person-running", open: false, mount: mountMotion }
  ]
});
