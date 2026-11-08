import { MODULE_ID } from "../config.mjs";
import * as SC from "./scene-core.mjs";
import { extendSection } from "../workspace/registry.mjs";
import { esc, T, optRange, optSelect, optCheck, optHint, isEcho, writeControl } from "../workspace/ui.mjs";
import { settings, testArrival } from "./source-scene.mjs";
import { killed } from "./director.mjs";

/**
 * The Director section's "Scene transitions" panel (GM): the world's arrival settings (dip, title card, establishing shot, which name
 * the card may show, timings) and THIS scene's own card (a title and a line under it instead of the name, or no arrival at all), plus
 * a test of the arrival here. Every control writes without echo; a value equal to the stored one is dropped.
 */
const SKEY = "dirArrival", FLAG = "dirScene";
const LBL = { on: "Dir.arr.on", dip: "Dir.arr.dip", card: "Dir.arr.card", shot: "Dir.arr.shot", login: "Dir.arr.login", names: "Dir.arr.names", cardMs: "Dir.arr.cardMs", glideMs: "Dir.arr.glideMs", holdMs: "Dir.arr.holdMs" };
const HNT = { on: "Dir.arr.h.on", dip: "Dir.arr.h.dip", card: "Dir.arr.h.card", shot: "Dir.arr.h.shot", login: "Dir.arr.h.login", names: "Dir.arr.h.names", cardMs: "Dir.arr.h.cardMs", glideMs: "Dir.arr.h.glideMs", holdMs: "Dir.arr.h.holdMs" };

function text({ name, label, value, hint, placeholder = "" }) {
  return `<div class="mm-ws-opt"><label${hint ? ` data-tooltip="${esc(hint)}"` : ""}>${esc(label)}</label><input type="text" name="${esc(name)}" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="120"></div>`;
}

export function renderArrivalPanel(host) {
  const s0 = settings(), scene = canvas?.scene ?? null, f0 = SC.cleanSceneFlag(scene?.getFlag?.(MODULE_ID, FLAG));
  const nameShown = () => (canvas?.scene ? SC.titleOf({ name: canvas.scene.name, navName: canvas.scene.navName }, {}, settings().names).title : "");
  host.innerHTML = `<div class="mm-ws-form mm-dir-arr-panel">
    ${optCheck({ name: "on", label: T(LBL.on), checked: s0.on, hint: T(HNT.on) })}
    ${optCheck({ name: "dip", label: T(LBL.dip), checked: s0.dip, hint: T(HNT.dip) })}
    ${optCheck({ name: "card", label: T(LBL.card), checked: s0.card, hint: T(HNT.card) })}
    ${optCheck({ name: "shot", label: T(LBL.shot), checked: s0.shot, hint: T(HNT.shot) })}
    ${optCheck({ name: "login", label: T(LBL.login), checked: s0.login, hint: T(HNT.login) })}
    ${optSelect({ name: "names", label: T(LBL.names), value: s0.names, options: [["nav", T("Dir.arr.namesNav")], ["navOnly", T("Dir.arr.namesNavOnly")]], hint: T(HNT.names) })}
    ${["cardMs", "glideMs", "holdMs"].map((k) => optRange({ name: k, label: `${T(LBL[k])} (ms)`, value: s0[k], min: SC.NUM[k][1], max: SC.NUM[k][2], step: 100, hint: T(HNT[k]) })).join("")}
    ${scene ? `<div class="mm-ws-sub"><strong>${esc(T("Dir.arr.thisScene"))}</strong></div>
    ${text({ name: "s_title", label: T("Dir.arr.sTitle"), value: f0.title, hint: T("Dir.arr.h.sTitle"), placeholder: nameShown() })}
    ${text({ name: "s_sub", label: T("Dir.arr.sSub"), value: f0.sub, hint: T("Dir.arr.h.sSub") })}
    ${optCheck({ name: "s_off", label: T("Dir.arr.sOff"), checked: f0.off, hint: T("Dir.arr.h.sOff") })}` : ""}
    <div class="mm-ws-actions"><button type="button" data-act="test"><i class="fa-solid fa-door-open" inert></i> ${esc(T("Dir.arr.test"))}</button></div>
    ${optHint(T("Dir.arr.hint"))}
    ${killed() ? optHint(T("Dir.killed")) : ""}</div>`;
  const ctl = (n) => host.querySelector(`[name="${n}"]`);
  const refresh = () => {
    const s = settings(), f = SC.cleanSceneFlag(canvas?.scene?.getFlag?.(MODULE_ID, FLAG));
    for ( const k of Object.keys(SC.DEFAULTS) ) { const c = ctl(k); if ( c && !c.contains(document.activeElement) ) writeControl(c, s[k]); }
    const vals = { s_title: f.title, s_sub: f.sub, s_off: f.off };
    for ( const [n, v] of Object.entries(vals) ) { const c = ctl(n); if ( c && c !== document.activeElement ) writeControl(c, v); }
    const t = ctl("s_title"); if ( t ) t.placeholder = nameShown();
  };
  const read = (c) => (c.matches("input[type=checkbox]") ? c.checked : c.matches("range-picker, input[type=number]") ? Number(c.value) : c.value);
  const onChange = async (ev) => {
    if ( isEcho() || !game.user.isGM ) return;
    const c = ev.target.closest?.("[name]"); if ( !c ) return;
    if ( c.name.startsWith("s_") ) {
      const sc = canvas?.scene; if ( !sc ) return;
      const f = SC.cleanSceneFlag(sc.getFlag(MODULE_ID, FLAG)), key = c.name.slice(2), next = SC.cleanSceneFlag({ ...f, [key]: read(c) });
      if ( JSON.stringify(next) === JSON.stringify(f) ) return;
      await sc.setFlag(MODULE_ID, FLAG, next);
      return;
    }
    if ( !(c.name in SC.DEFAULTS) ) return;
    const s = settings(), next = SC.cleanSettings({ ...s, [c.name]: read(c) });
    if ( next[c.name] === s[c.name] ) { refresh(); return; }
    await game.settings.set(MODULE_ID, SKEY, next);
  };
  const onClick = (ev) => {
    const a = ev.target.closest?.("[data-act]")?.dataset.act; if ( !a ) return;
    if ( a === "test" && !testArrival() ) ui.notifications?.info(T("Dir.arr.testNo"));
  };
  host.addEventListener("change", onChange);
  host.addEventListener("click", onClick);
  const hSet = Hooks.on("updateSetting", (doc) => { if ( doc?.key === `${MODULE_ID}.${SKEY}` ) refresh(); });
  const hScene = Hooks.on("updateScene", (doc) => { if ( doc.id === canvas?.scene?.id ) refresh(); });
  const hReady = Hooks.on("canvasReady", () => refresh());
  refresh();
  return () => {
    host.removeEventListener("change", onChange); host.removeEventListener("click", onClick);
    Hooks.off("updateSetting", hSet); Hooks.off("updateScene", hScene); Hooks.off("canvasReady", hReady);
    host.innerHTML = "";
  };
}

extendSection("director", { panels: [{ id: "arrival", title: "MOINENMAPS.Dir.arr.panel", icon: "fa-solid fa-door-open", open: false, mount: (host) => renderArrivalPanel(host) }] });
