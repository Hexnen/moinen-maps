import { MODULE_ID, sceneConfig } from "../config.mjs";
import { fg } from "../labels.mjs";
import { esc, T, isEcho, writeControl, keepFolds, tipHints } from "./ui.mjs";

/**
 * Dock panels that edit the config of the VIEWED scene (`flags.moinen-maps.config.<key>`), the options that used to live in the
 * Scene Config tab. Controls are plain named fields (`name="flags.moinen-maps.config.<key>"`, nested keys with dots); a change of
 * one control writes that one key at once (GM only). Rows that do not apply are hidden, the panel follows the scene's updates in
 * place (folds and focus stay) and is drawn again on a scene switch.
 */
export const N = `flags.${MODULE_ID}.config`;
const getP = (o, k) => foundry.utils.getProperty(o, k);

/** Field builders: `c` is the resolved scene config, `key` the config key (dots for nested), labels and hints are lang keys. */
export const sf = {
  range: (c, key, label, min, max, step, hint = "") =>
    fg(T(label), `<range-picker name="${N}.${key}" value="${Number(getP(c, key))}" min="${min}" max="${max}" step="${step}"></range-picker>`, hint ? T(hint) : ""),
  check: (c, key, label, hint = "") => fg(T(label), `<input type="checkbox" name="${N}.${key}"${getP(c, key) ? " checked" : ""}>`, hint ? T(hint) : ""),
  select: (c, key, label, opts, hint = "") =>
    fg(T(label), `<select name="${N}.${key}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(getP(c, key)) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`, hint ? T(hint) : ""),
  color: (c, key, label, fallback = "#ffffff", hint = "") => fg(T(label), `<color-picker name="${N}.${key}" value="${esc(getP(c, key) || fallback)}"></color-picker>`, hint ? T(hint) : "")
};

/** The value a control stands for, typed the way the Scene Config form stored it. */
function readValue(el) {
  if ( el.type === "checkbox" ) return el.checked;
  if ( el.tagName === "RANGE-PICKER" || el.type === "number" || el.type === "range" ) { const n = Number(el.value); return Number.isFinite(n) ? n : undefined; }
  return el.value;
}

/**
 * Mount a scene-config form into a dock panel host.
 * @param {HTMLElement} host
 * @param {object} o
 * @param {(c: object, scene: Scene) => string} o.html   the controls for the resolved config `c`
 * @param {Array<[string, (val: (key: string) => any) => boolean]>} [o.deps]   selector -> shown while true (reads the form's current values)
 * @param {Set<string>} [o.folds]   open folds, kept across redraws
 * @param {(form: HTMLElement) => (void|Function)} [o.wire]   extra wiring of a fresh form (previews); may return a cleanup
 * @returns {() => void} cleanup
 */
export function sceneForm(host, { html, deps = [], folds = null, wire = null }) {
  let cleanup = null;
  const field = (k) => host.querySelector(`[name="${N}.${k}"]`);
  const val = (k) => { const el = field(k); return el ? readValue(el) : getP(sceneConfig(canvas?.scene), k); };
  const applyDeps = () => {
    for ( const [sel, test] of deps ) { const on = !!test(val); for ( const el of host.querySelectorAll(sel) ) { el.hidden = !on; el.inert = !on; } }
  };
  const render = () => {
    cleanup?.(); cleanup = null;
    const s = canvas?.scene;
    if ( !s ) { host.innerHTML = `<p class="hint">${esc(T("Zones.noScene"))}</p>`; return; }
    host.innerHTML = `<div class="mm-ws-form mm-sc-form">${html(sceneConfig(s), s)}</div>`;
    tipHints(host);
    if ( !game.user.isGM ) host.querySelectorAll("input, select, range-picker, color-picker").forEach((c) => { c.disabled = true; });
    applyDeps();
    const r = wire?.(host.firstElementChild); if ( typeof r === "function" ) cleanup = r;
  };
  const onChange = (ev) => {
    // only a named control's own event: a <range-picker>'s inner inputs report first, unnamed, with the old value
    const el = ev.target, name = el?.getAttribute?.("name") ?? "";
    if ( !name.startsWith(`${N}.`) ) return;
    applyDeps();
    if ( isEcho() || !game.user.isGM ) return;
    const s = canvas?.scene; if ( !s ) return;
    const v = readValue(el);
    // always written: a "same as stored" skip would drop a quick second toggle made before the first write came back
    if ( v === undefined ) return;
    s.update({ [name]: v });
  };
  // the scene changed (here, in another window or by another GM): the controls take the stored values in place
  const sync = () => {
    const c = sceneConfig(canvas?.scene);
    for ( const el of host.querySelectorAll(`[name^="${N}."]`) ) {
      const v = getP(c, el.getAttribute("name").slice(N.length + 1));
      if ( v === undefined || (el.tagName === "COLOR-PICKER" && !/^#/.test(String(v))) ) continue;   // "" / "auto": the picker keeps its stand-in colour
      writeControl(el, v);
    }
    applyDeps();
    host.firstElementChild?.dispatchEvent(new Event("change", { bubbles: true }));   // the field helpers' own greying follows
  };
  const onScene = (s, ch) => { if ( s.id === canvas?.scene?.id && foundry.utils.hasProperty(ch, `flags.${MODULE_ID}`) ) sync(); };
  host.addEventListener("change", onChange);
  const offFolds = folds ? keepFolds(host, folds) : null;
  const hU = Hooks.on("updateScene", onScene), hC = Hooks.on("canvasReady", render);
  render();
  return () => { cleanup?.(); offFolds?.(); host.removeEventListener("change", onChange); Hooks.off("updateScene", hU); Hooks.off("canvasReady", hC); };
}
