import { MODULE_ID } from "../config.mjs";

/**
 * Small building blocks for options bars and dock panels: labelled controls bound to client settings, and a subscription to setting
 * changes so a control follows a value changed elsewhere (the [ ] keys, another panel, the module settings).
 */

export const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
export const T = (k) => game.i18n.localize(`MOINENMAPS.${k}`);
export const setting = (k) => { try { return game.settings.get(MODULE_ID, k); } catch { return undefined; } };
export const store = (k, v) => game.settings.set(MODULE_ID, k, v);

let N = 0;
const uid = (name) => `mm-ws-${String(name).replace(/[^\w-]/g, "")}-${++N}`;

/**
 * Call `fn(key)` whenever one of these client settings of the module changes (key without the module prefix). Returns the unsubscribe.
 * @param {string[]} keys
 * @param {(key: string) => void} fn
 */
export function onSetting(keys, fn) {
  const prefix = `${MODULE_ID}.`;
  const id = Hooks.on("clientSettingChanged", (key) => {
    if ( !String(key).startsWith(prefix) ) return;
    const k = key.slice(prefix.length);
    if ( keys.includes(k) ) fn(k);
  });
  return () => Hooks.off("clientSettingChanged", id);
}

/** A slider with its number field. */
export function optRange({ name, label, value, min, max, step, hint = "" }) {
  const id = uid(name);
  return `<div class="mm-ws-opt mm-ws-range"><label for="${id}"${hint ? ` data-tooltip="${esc(hint)}"` : ""}>${esc(label)}</label><range-picker id="${id}" name="${esc(name)}" value="${Number(value)}" min="${min}" max="${max}" step="${step}"></range-picker></div>`;
}

/** A drop-down; `options` = [[value, label], ...]. */
export function optSelect({ name, label, value, options, hint = "" }) {
  const id = uid(name);
  return `<div class="mm-ws-opt"><label for="${id}"${hint ? ` data-tooltip="${esc(hint)}"` : ""}>${esc(label)}</label><select id="${id}" name="${esc(name)}">${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div>`;
}

/** A checkbox with its label after it. */
export function optCheck({ name, label, checked, hint = "" }) {
  return `<label class="mm-ws-opt mm-ws-check"${hint ? ` data-tooltip="${esc(hint)}"` : ""}><input type="checkbox" name="${esc(name)}"${checked ? " checked" : ""}> <span>${esc(label)}</span></label>`;
}

/** A short line of guidance at the end of a bar (keyboard and mouse modifiers of the tool). */
export const optHint = (text) => `<span class="mm-ws-hint">${esc(text)}</span>`;

/**
 * Wire a host's named controls to client settings: `map` = { controlName: settingKey | { key, read(control), write(value, control) } }.
 * A change stores the value; a change of the setting from elsewhere updates the control (unless it has focus). Returns the cleanup.
 * `onInput(name, value)` (optional) previews a value while a slider is being dragged.
 */
export function bindSettings(host, map, { onInput } = {}) {
  const spec = Object.fromEntries(Object.entries(map).map(([n, v]) => [n, typeof v === "string" ? { key: v } : v]));
  const valueOf = (c) => c.matches("input[type=checkbox]") ? c.checked : c.matches("range-picker, input[type=number]") ? Number(c.value) : c.value;
  const onChange = (ev) => {
    const c = ev.target.closest?.("[name]"), s = c && spec[c.name]; if ( !s ) return;
    const v = s.read ? s.read(c) : valueOf(c);
    store(s.key, v);
  };
  const onIn = (ev) => {
    const c = ev.target.closest?.("[name]"); if ( !c || !spec[c.name] || !onInput ) return;
    // a range-picker's own value only changes on release; while dragging, its inner slider has the number
    onInput(c.name, ev.target.matches?.("input[type=range]") ? ev.target.valueAsNumber : valueOf(c));
  };
  host.addEventListener("change", onChange);
  host.addEventListener("input", onIn);
  const off = onSetting(Object.values(spec).map((s) => s.key), (key) => {
    for ( const [n, s] of Object.entries(spec) ) {
      if ( s.key !== key ) continue;
      const c = host.querySelector(`[name="${n}"]`); if ( !c || c.contains(document.activeElement) ) continue;
      const v = setting(key);
      if ( s.write ) s.write(v, c);
      else if ( c.matches("input[type=checkbox]") ) c.checked = !!v;
      else c.value = v;
    }
  });
  return () => { host.removeEventListener("change", onChange); host.removeEventListener("input", onIn); off(); };
}
