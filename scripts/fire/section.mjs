import { extendSection } from "../workspace/registry.mjs";
import { esc, T, optRange, optSelect, optCheck, optHint, isEcho, writeControl, bindSettings, onSetting } from "../workspace/ui.mjs";
import { MODULE_ID } from "../config.mjs";
import * as M from "./model.mjs";
import * as Fire from "./fire.mjs";
import * as Editor from "./editor.mjs";

/**
 * FIRE AND SMOKE in the Destruction workspace (added with extendSection: section.mjs is unchanged):
 *  - tools: a fire brush, a smoke brush, an eraser of this layer;
 *  - bar: size, strength and wind (direction + strength) of the brush in hand (client settings; pinned on each stroke);
 *  - dock panel "Fire and smoke": the layer on/off, who sees it, flame height, plume length, smoke from fire, speed, the light
 *    (on, radius, intensity, colour, flicker) and the list of strokes (newest first, delete one), Clear.
 */
const TOOLS = { "mm-fire-paint": "fire", "mm-fire-smoke": "smoke", "mm-fire-erase": "erase" };
const KIND_ICON = { fire: "fa-solid fa-fire", smoke: "fa-solid fa-smog", erase: "fa-solid fa-eraser" };
const KIND_INK = { fire: "#ff8a24", smoke: "#a8a29a", erase: "#ffffff" };
/** The eight wind directions (degrees, screen: 0 = right, 90 = down), drawn as one arrow turned. */
const DIRS = [270, 315, 0, 45, 90, 135, 180, 225];

/* ---------------------------------------------------------------- the bar */

function bar(host, ctx) {
  const mode = TOOLS[ctx.tool], b = Editor.brush();
  const size = optRange({ name: "fireBrush", label: T("Fire.size"), value: b.size, min: 0.25, max: 10, step: 0.25, hint: T("Fire.sizeHint") });
  if ( mode === "erase" ) host.innerHTML = `${size}${optHint(T("Fire.eraseHint"))}`;
  else {
    const dirs = DIRS.map((d) => `<button type="button" class="mm-ws-toolbtn" data-wind-dir="${d}" aria-pressed="${d === b.windDir}" aria-label="${esc(T(`Fire.dir.${d}`))}" data-tooltip="${esc(T(`Fire.dir.${d}`))}"><i class="fa-solid fa-arrow-right fa-rotate-by" style="--fa-rotate-angle:${d}deg" inert></i></button>`).join("");
    host.innerHTML = `${size}
      ${optRange({ name: "fireStrength", label: T("Fire.strength"), value: b.strength, min: 0.1, max: 1, step: 0.05, hint: T("Fire.strengthHint") })}
      ${optRange({ name: "fireWind", label: T("Fire.wind"), value: b.wind, min: 0, max: 1, step: 0.05, hint: T("Fire.windHint") })}
      <div class="mm-ws-opt"><span class="mm-ws-label">${esc(T("Fire.windDir"))}</span><div class="mm-ws-tools" role="group" aria-label="${esc(T("Fire.windDir"))}">${dirs}</div></div>
      ${optHint(mode === "smoke" ? T("Fire.smokeHint") : T("Fire.paintHint"))}`;
  }
  const off = bindSettings(host, { fireBrush: "fireBrush", fireStrength: "fireStrength", fireWind: "fireWind" });
  const onClick = (ev) => { const d = ev.target.closest?.("[data-wind-dir]"); if ( d ) game.settings.set(MODULE_ID, "fireWindDir", Number(d.dataset.windDir)); };
  host.addEventListener("click", onClick);
  const offDir = onSetting(["fireWindDir"], () => { for ( const x of host.querySelectorAll("[data-wind-dir]") ) x.setAttribute("aria-pressed", String(Number(x.dataset.windDir) === Editor.brush().windDir)); });
  return () => { off(); offDir(); host.removeEventListener("click", onClick); };
}

/* ---------------------------------------------------------------- the dock */

function mountPanel(host) {
  const gm = game.user.isGM;
  const render = () => {
    const P = Fire.params0(), L = M.LIMITS, st = Fire.fireApi.status();
    const range = (k, step = 0.05) => optRange({ name: `p.${k}`, label: T(`Fire.f.${k}`), value: P[k], min: L[k][0], max: L[k][1], step, hint: T(`Fire.h.${k}`) });
    const rows = Fire.list().reverse().map((s) => {
      const name = T(`Fire.kind.${s.k}`), tip = s.k === "erase" ? name : `${name} · ${Math.round(s.s * 100)}% · ${T("Fire.wind")} ${Math.round(s.ws * 100)}%`;
      return `<li data-stroke="${esc(s.id)}"><i class="${KIND_ICON[s.k]}" style="color:${KIND_INK[s.k]}" inert></i><span class="mm-d-kind" data-tooltip="${esc(tip)}">${esc(name)}</span>
        ${gm ? `<button type="button" class="mm-fire-del" data-act="del" data-id="${esc(s.id)}" aria-label="${esc(T("Fire.delete"))}" data-tooltip="${esc(T("Fire.delete"))}"><i class="fa-solid fa-trash" inert></i></button>` : "<span></span>"}</li>`;
    }).join("");
    host.innerHTML = `<div class="mm-d-form mm-fire-panel">
      <p class="mm-d-status" role="status">${esc(game.i18n.format("MOINENMAPS.Fire.status", { n: st.strokes, a: st.areas, l: st.lights }))}</p>
      ${rows ? `<ul class="mm-d-areas mm-d-objs mm-fire-list" aria-label="${esc(T("Fire.strokes"))}">${rows}</ul>` : `<p class="mm-ws-hint">${esc(T("Fire.empty"))}</p>`}
      <div class="mm-d-actions"><button type="button" class="mm-ws-btn" data-act="clear"${st.strokes && gm ? "" : " disabled"}><i class="fa-solid fa-trash" inert></i> ${esc(T("Fire.clear"))}</button></div>
      ${optCheck({ name: "p.on", label: T("Fire.f.on"), checked: P.on, hint: T("Fire.h.on") })}
      ${optSelect({ name: "p.who", label: T("Fire.f.who"), value: P.who, options: [["all", T("Fire.o.all")], ["gm", T("Fire.o.gm")]] })}
      ${range("flame")}${range("plume", 0.25)}${range("smoke")}${range("speed")}
      <fieldset class="mm-fire-light"><legend>${esc(T("Fire.light"))}</legend>
        ${optCheck({ name: "p.light", label: T("Fire.f.light"), checked: P.light, hint: T("Fire.h.light") })}
        ${range("lightRadius", 0.1)}${range("lightIntensity")}${range("lightFlicker")}
        <div class="mm-ws-opt"><label data-tooltip="${esc(T("Fire.h.lightColor"))}">${esc(T("Fire.f.lightColor"))}</label><input type="color" name="p.lightColor" value="${esc(P.lightColor)}"></div>
      </fieldset></div>`;
    if ( !gm ) for ( const c of host.querySelectorAll("[name^='p.']") ) c.disabled = true;
  };
  render();
  const read = (c) => c.matches("input[type=checkbox]") ? c.checked : c.matches("range-picker, input[type=number]") ? Number(c.value) : c.value;
  const onChange = (ev) => {
    if ( isEcho() || !gm ) return;
    const c = ev.target.closest?.("[name^='p.']"); if ( !c ) return;
    const k = c.name.slice(2), v = read(c);
    if ( v !== Fire.params0()[k] ) Fire.setParams({ [k]: v });
  };
  const onClick = async (ev) => {
    const b = ev.target.closest?.("[data-act]"); if ( !b || !gm ) return;
    b.blur();
    if ( b.dataset.act === "del" ) Fire.remove(b.dataset.id);
    else if ( b.dataset.act === "clear" ) {
      const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: T("Fire.clear") }, content: `<p>${esc(T("Fire.clearConfirm"))}</p>` }).catch(() => false);
      if ( ok ) Fire.clear();
    }
  };
  host.addEventListener("change", onChange); host.addEventListener("click", onClick);
  let frame = 0;
  const id = Hooks.on("moinenMapsFire", (kind) => {
    if ( frame ) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if ( !host.contains(document.activeElement) || document.activeElement === document.body ) { render(); return; }
      const P = Fire.params0();
      for ( const c of host.querySelectorAll("[name^='p.']") ) if ( !c.contains(document.activeElement) ) writeControl(c, P[c.name.slice(2)]);
    });
  });
  return () => { host.removeEventListener("change", onChange); host.removeEventListener("click", onClick); Hooks.off("moinenMapsFire", id); cancelAnimationFrame(frame); };
}

/* ---------------------------------------------------------------- wiring */

const OFF = (() => { try { return globalThis.localStorage?.getItem("mm-destruction") === "off" || globalThis.localStorage?.getItem("mm-fire") === "off"; } catch { return false; } })();

if ( !OFF ) {
  Fire.registerFire();
  Hooks.once("init", () => Editor.registerFireSettings(() => Fire.tell("brush")));
  Hooks.on("canvasReady", () => Editor.onCanvasReady());
  Hooks.on("canvasTearDown", () => Editor.teardown());
  Hooks.once("init", () => extendSection("destruction", {
    tools: () => [
      { name: "mm-fire-paint", order: 4, title: "MOINENMAPS.Fire.tool.fire", icon: "fa-solid fa-fire", color: KIND_INK.fire },
      { name: "mm-fire-smoke", order: 5, title: "MOINENMAPS.Fire.tool.smoke", icon: "fa-solid fa-smog", color: KIND_INK.smoke },
      { name: "mm-fire-erase", order: 6, title: "MOINENMAPS.Fire.tool.erase", icon: "fa-solid fa-fire-extinguisher", color: KIND_INK.erase }
    ],
    bars: Object.fromEntries(Object.keys(TOOLS).map((t) => [t, bar])),
    onToolChange: (tool, active) => { if ( tool in TOOLS ) Editor.setMode(active ? TOOLS[tool] : null); },
    panels: [{ id: "fire", title: "MOINENMAPS.Fire.panel", icon: "fa-solid fa-fire", open: true, mount: mountPanel }]
  }));
}
