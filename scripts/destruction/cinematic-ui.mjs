import { esc, T, optSelect, optCheck, optHint } from "../workspace/ui.mjs";
import * as D from "./destruction.mjs";

/**
 * Cinematic mode in the destruction section (section.mjs calls these): the Damage panel's block (mode, GM preview, "N staged",
 * Action!, Reveal now) and the paint bar's two quick buttons (mode cycle, Action with the count). GM only. Nothing here writes while
 * rendering: the controls are rebuilt from the scene's block (no echo), a change goes through setCinematic (a live setting, nothing bakes).
 */
export const MODES = ["off", "drags", "all"];
const api = () => D.destructionApi;
export const cinP = () => D.state()?.params?.cinematic ?? { mode: "off", preview: true };
export const info = () => api().cinematic.status();
export const countText = () => game.i18n.format("MOINENMAPS.Destr.cin.staged", { n: info().staged });
const canAct = (I = info()) => !!(I.staged && !I.showing && !I.killed);
const modeLabel = (m) => `${T("Destr.cin.mode")}: ${T(`Destr.cin.${m}`)}`;

/** The block of the Damage panel. */
export function block() {
  if ( !game.user.isGM ) return "";
  const P = cinP(), I = info(), on = P.mode !== "off" && !I.killed;
  return `<div class="mm-d-cin" data-cin>
    ${optSelect({ name: "cin.mode", label: T("Destr.cin.mode"), value: P.mode, hint: T("Destr.cin.modeHint"), options: MODES.map((m) => [m, T(`Destr.cin.${m}`)]) })}
    ${optCheck({ name: "cin.preview", label: T("Destr.cin.preview"), checked: P.preview, hint: T("Destr.cin.previewHint") })}
    <div class="mm-d-actions mm-d-cinrow">
      <span class="mm-d-cinn" role="status" data-cin-count>${esc(countText())}</span>
      <button type="button" class="mm-ws-btn mm-d-action" data-act="cinAction" data-tooltip="${esc(T("Destr.cin.actionHint"))}"${canAct(I) ? "" : " disabled"}><i class="fa-solid fa-clapperboard" inert></i> ${esc(T("Destr.cin.action"))}</button>
      <button type="button" class="mm-ws-btn" data-act="cinSkip"${I.staged || I.showing ? "" : " disabled"}><i class="fa-solid fa-forward" inert></i> ${esc(T("Destr.cin.skip"))}</button>
    </div>
    ${I.killed ? optHint(T("Destr.cin.killed")) : on ? "" : optHint(T("Destr.cin.offHint"))}</div>`;
}
/** What changes while the block is on screen (the count, which buttons work) without rebuilding it (a focused control keeps its focus). */
export function sync(host) {
  const I = info();
  const n = host.querySelector("[data-cin-count]"); if ( n ) n.textContent = countText();
  const a = host.querySelector("[data-act=cinAction]"); if ( a ) a.disabled = !canAct(I);
  const s = host.querySelector("[data-act=cinSkip]"); if ( s ) s.disabled = !(I.staged || I.showing);
}
/** A change event from the panel: true when it was one of ours. */
export function change(ev) {
  const c = ev.target.closest?.("[name^='cin.']"); if ( !c ) return false;
  if ( !game.user.isGM ) return true;
  if ( c.name === "cin.mode" && MODES.includes(c.value) ) api().setCinematic({ mode: c.value });
  if ( c.name === "cin.preview" ) api().setCinematic({ preview: !!c.checked });
  return true;
}
/** A click on the panel's buttons: true when it was one of ours. */
export function click(act) {
  if ( act === "cinAction" ) { api().cinematic.action(); return true; }
  if ( act === "cinSkip" ) { api().cinematic.skip(); return true; }
  return false;
}

/** The paint bar's two buttons. */
export function barButtons() {
  if ( !game.user.isGM ) return "";
  const P = cinP(), I = info(), label = modeLabel(P.mode);
  return `<button type="button" class="mm-ws-toolbtn" data-cin-mode aria-pressed="${P.mode !== "off"}" aria-label="${esc(label)}" data-tooltip="${esc(label)}"><i class="fa-solid fa-film" inert></i></button>`
    + `<button type="button" class="mm-ws-toolbtn mm-d-actbtn" data-cin-action aria-label="${esc(T("Destr.cin.action"))}" data-tooltip="${esc(`${T("Destr.cin.actionHint")} (Shift+Enter)`)}"${canAct(I) ? "" : " disabled"}><i class="fa-solid fa-clapperboard" inert></i><span class="mm-d-cinbadge" data-cin-badge>${I.staged || ""}</span></button>`;
}
export function barSync(host) {
  const I = info(), P = cinP(), cm = host.querySelector("[data-cin-mode]");
  if ( cm ) { const label = modeLabel(P.mode); cm.setAttribute("aria-pressed", String(P.mode !== "off")); cm.setAttribute("aria-label", label); cm.dataset.tooltip = label; }
  const ca = host.querySelector("[data-cin-action]");
  if ( ca ) { ca.disabled = !canAct(I); const b = ca.querySelector("[data-cin-badge]"); if ( b ) b.textContent = I.staged || ""; }
}
/** A click on the bar: true when it was one of ours. */
export function barClick(ev) {
  if ( ev.target.closest("[data-cin-mode]") ) { api().setCinematic({ mode: MODES[(MODES.indexOf(cinP().mode) + 1) % MODES.length] }); return true; }
  if ( ev.target.closest("[data-cin-action]:not([disabled])") ) { api().cinematic.action(); return true; }
  return false;
}
