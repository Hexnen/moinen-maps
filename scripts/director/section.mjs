import { MODULE_ID } from "../config.mjs";
import * as Dir from "./core.mjs";
import * as Cin from "../destruction/cinematic-core.mjs";
import { registerSection } from "../workspace/registry.mjs";
import { esc, T, optRange, optSelect, optCheck, optHint, optFold, keepFolds, isEcho, writeControl, onSetting, bindSettings } from "../workspace/ui.mjs";
import { renderCinematicPanel } from "../destruction/cinematic-panel.mjs";
import * as D from "./director.mjs";

/**
 * The DIRECTOR section of the workspace (GM): the director's settings (world: on/off, preset, the look of the take-overs, the sources,
 * the timings), a test take-over, the players' own options (client; every player also has them in Foundry's settings), and the
 * cinematic effects panel of the destruction show (the same engine). Every control writes WITHOUT echo (ui.mjs writeControl/isEcho) and
 * a value equal to the stored one is dropped.
 */

const UNIT = (k) => Dir.NUM[k]?.[3] ? ` (${Dir.NUM[k][3]})` : "";
const step = (k) => { const u = Dir.NUM[k]?.[3]; return u === "ms" ? 50 : u === "sq" ? 1 : 0.05; };
const TIMING = ["takeAt", "softAt", "merge", "mergeSq", "cooldown", "rest", "stale", "lead", "back", "holdK", "maxShot", "zoomIn", "softMs"];
const PRESET_LABEL = { calm: "Dir.pn.calm", standard: "Dir.pn.standard", dramatic: "Dir.pn.dramatic", documentary: "Dir.pn.documentary", custom: "Dir.pn.custom" };
const SRC_LABEL = { destruction: "Dir.src.destruction", fire: "Dir.src.fire", zones: "Dir.src.zones", orbit: "Dir.src.orbit", altitude: "Dir.src.altitude", attacks: "Dir.src.attacks", rolls: "Dir.src.rolls" };
const LABEL = {
  takeAt: "Dir.p.takeAt", softAt: "Dir.p.softAt", merge: "Dir.p.merge", mergeSq: "Dir.p.mergeSq", cooldown: "Dir.p.cooldown", rest: "Dir.p.rest", stale: "Dir.p.stale",
  lead: "Dir.p.lead", back: "Dir.p.back", holdK: "Dir.p.holdK", maxShot: "Dir.p.maxShot", zoomIn: "Dir.p.zoomIn", softMs: "Dir.p.softMs"
};
const HINT = {
  takeAt: "Dir.h.takeAt", softAt: "Dir.h.softAt", merge: "Dir.h.merge", mergeSq: "Dir.h.mergeSq", cooldown: "Dir.h.cooldown", rest: "Dir.h.rest", stale: "Dir.h.stale",
  lead: "Dir.h.lead", back: "Dir.h.back", holdK: "Dir.h.holdK", maxShot: "Dir.h.maxShot", zoomIn: "Dir.h.zoomIn", softMs: "Dir.h.softMs"
};
const folds = new Set();

const block = () => Dir.sanitize(game.settings.get(MODULE_ID, "director"));
const setBlock = (b) => game.settings.set(MODULE_ID, "director", b);
const userPresets = () => game.settings.get(MODULE_ID, "cinUserPresets") ?? {};
const lookOptions = () => [...Cin.PRESET_IDS.map((id) => [id, T(`Destr.cin.pn.${id}`)]), ...Object.entries(userPresets()).map(([id, u]) => [id, u?.name ?? id])];

export function renderDirectorPanel(host) {
  const r0 = Dir.resolve(block()), b0 = block();
  const presetOpts = (b) => [...Dir.PRESET_IDS, "custom"].map((id) => [id, T(PRESET_LABEL[id]) + (id === b.preset && Object.keys(b.over).length ? " *" : "")]);
  host.innerHTML = `<div class="mm-ws-form mm-dir-panel">
    ${optCheck({ name: "directorOn", label: T("Dir.p.enabled"), checked: D.isOn(), hint: T("Dir.h.enabled") })}
    ${optSelect({ name: "preset", label: T("Dir.p.preset"), value: b0.preset, options: presetOpts(b0), hint: T("Dir.h.preset") })}
    ${optSelect({ name: "look", label: T("Dir.p.look"), value: r0.look, options: lookOptions(), hint: T("Dir.h.look") })}
    ${optCheck({ name: "captions", label: T("Dir.p.captions"), checked: r0.captions, hint: T("Dir.h.captions") })}
    ${optCheck({ name: "softOn", label: T("Dir.p.softOn"), checked: r0.softOn, hint: T("Dir.h.softOn") })}
    ${optFold({ id: "src", title: T("Dir.g.sources"), icon: "fa-solid fa-satellite-dish", open: folds, body: Dir.GROUPS.map((g) => optCheck({ name: `src_${g}`, label: T(SRC_LABEL[g]), checked: r0[`src_${g}`] })).join("") })}
    ${optFold({ id: "timing", title: T("Dir.g.timing"), icon: "fa-solid fa-stopwatch", open: folds, body: TIMING.map((k) => optRange({ name: k, label: T(LABEL[k]) + UNIT(k), value: r0[k], min: Dir.NUM[k][1], max: Dir.NUM[k][2], step: step(k), hint: T(HINT[k]) })).join("") })}
    <div class="mm-ws-actions">
      <button type="button" data-act="test"><i class="fa-solid fa-play" inert></i> ${esc(T("Dir.test"))}</button>
      <button type="button" data-act="reset"><i class="fa-solid fa-rotate-left" inert></i> ${esc(T("Dir.reset"))}</button></div>
    ${optFold({ id: "mine", title: T("Dir.g.mine"), icon: "fa-solid fa-display", open: folds, body: `
      ${optSelect({ name: "dirMode", label: T("Dir.set.mode"), value: game.settings.get(MODULE_ID, "dirMode"), options: [["auto", T("Dir.set.modeAuto")], ["full", T("Dir.set.modeFull")], ["soft", T("Dir.set.modeSoft")], ["off", T("Dir.set.modeOff")]], hint: T("Dir.set.modeHint") })}
      ${optRange({ name: "dirIntensity", label: T("Dir.set.intensity"), value: game.settings.get(MODULE_ID, "dirIntensity"), min: 0, max: 1, step: 0.05, hint: T("Dir.set.intensityHint") })}
      ${optSelect({ name: "cinReduced", label: T("Destr.cin.reducedSetting"), value: game.settings.get(MODULE_ID, "cinReduced"), options: [["auto", T("Destr.cin.redAuto")], ["on", T("Destr.cin.redOn")], ["off", T("Destr.cin.redOff")]], hint: T("Destr.cin.reducedHint") })}
      ${optHint(T("Dir.h.players"))}` })}
    ${D.killed() ? optHint(T("Dir.killed")) : ""}</div>`;
  const offFolds = keepFolds(host, folds);
  const ctl = (n) => host.querySelector(`[name="${n}"]`);

  function refresh() {
    const b = block(), r = Dir.resolve(b);
    const sel = ctl("preset");
    if ( sel && !sel.contains(document.activeElement) ) {
      const want = JSON.stringify(presetOpts(b));
      if ( sel.dataset.opts !== want ) { sel.innerHTML = presetOpts(b).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join(""); sel.dataset.opts = want; }
      writeControl(sel, b.preset);
    }
    // (the looks: the GM's own cinematic presets come and go - saved in the look panel below - while this panel is open)
    const lk = ctl("look");
    if ( lk && !lk.contains(document.activeElement) ) {
      const want = JSON.stringify(lookOptions());
      if ( lk.dataset.opts !== want ) { lk.innerHTML = lookOptions().map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join(""); lk.dataset.opts = want; }
    }
    for ( const k of Dir.KEYS ) { const c = ctl(k); if ( c && !c.contains(document.activeElement) ) writeControl(c, r[k]); }
    { const c = ctl("directorOn"); if ( c && !c.contains(document.activeElement) ) writeControl(c, D.isOn()); }
    host.querySelector(".mm-dir-panel")?.classList.toggle("is-off", !D.isOn() || !r.enabled);
  }
  const read = (c) => c.matches("input[type=checkbox]") ? c.checked : c.matches("range-picker, input[type=number]") ? Number(c.value) : c.value;
  const onChange = (ev) => {
    if ( isEcho() ) return;
    const c = ev.target.closest?.("[name]"); if ( !c ) return;
    const b = block(), r = Dir.resolve(b);
    if ( c.name === "directorOn" ) { if ( c.checked !== D.isOn() ) D.setOn(c.checked); return; }
    if ( c.name === "preset" ) {
      if ( c.value === b.preset ) return;
      setBlock({ ...b, preset: c.value, over: c.value === "custom" ? Dir.cleanPartial(r) : {} });
    } else if ( Dir.KEYS.includes(c.name) ) {
      const v = Dir.cleanValue(c.name, read(c));
      if ( v === undefined || v === r[c.name] ) { refresh(); return; }
      setBlock({ ...b, over: { ...b.over, [c.name]: v } });
    }
  };
  const onClick = (ev) => {
    const a = ev.target.closest?.("[data-act]")?.dataset.act; if ( !a ) return;
    if ( a === "test" ) { if ( !D.preview() ) ui.notifications?.info(T("Dir.testNo")); }
    else if ( a === "reset" ) setBlock({ ...block(), over: {} });
  };
  host.addEventListener("change", onChange);
  host.addEventListener("click", onClick);
  const offBind = bindSettings(host, { dirMode: "dirMode", dirIntensity: "dirIntensity", cinReduced: "cinReduced" });
  const hook = Hooks.on(D.HOOK, (kind) => { if ( kind === "state" ) refresh(); });
  const offSet = onSetting(["cinUserPresets"], () => refresh());
  refresh();
  return () => {
    host.removeEventListener("change", onChange); host.removeEventListener("click", onClick);
    offBind?.(); offSet?.(); offFolds(); Hooks.off(D.HOOK, hook);
    host.innerHTML = "";
  };
}

registerSection({
  id: "director", order: 8, title: "MOINENMAPS.WS.director", icon: "fa-solid fa-clapperboard", color: "#e9c46a",
  bar: (host) => { host.innerHTML = optHint(T("Dir.barHint")); },
  panels: [
    { id: "director", title: "MOINENMAPS.Dir.title", icon: "fa-solid fa-video", mount: (host) => renderDirectorPanel(host) },
    { id: "look", title: "MOINENMAPS.Dir.lookPanel", icon: "fa-solid fa-film", open: false, mount: (host) => renderCinematicPanel(host, { scene: globalThis.canvas?.scene, readOnly: !game.user.isGM }) }
  ]
});
