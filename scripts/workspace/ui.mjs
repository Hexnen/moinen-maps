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
 * Write a value into a control WITHOUT it reporting a change: Foundry's <range-picker> / <color-picker> dispatch "input" and "change"
 * whenever their value is set from code (even to the same value). Echoing a stored value back into a control must never look like
 * the user's edit (control -> setting -> hook -> control); change handlers return early while `isEcho()` is true.
 */
let echoing = 0;
export const isEcho = () => echoing > 0;
export function writeControl(c, v) {
  if ( c.matches("input[type=checkbox]") ) { if ( c.checked !== !!v ) c.checked = !!v; return; }
  if ( String(c.value) === String(v) || (typeof v === "number" && Number(c.value) === v) ) return;
  echoing++;
  try { c.value = v; } finally { echoing--; }
}

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
 * A folding group of a dock panel (the zones panel's pattern): a <details> whose open state lives in `open`, a Set the panel keeps
 * across re-renders (see keepFolds). `head` (optional) is extra markup inside the summary, e.g. the group's own on/off switch.
 */
export function optFold({ id, title, icon = "", body, open, head = "", cls = "", attrs = "" }) {
  return `<details class="mm-fold mm-ws-group${cls ? ` ${cls}` : ""}" data-fold="${esc(id)}"${attrs ? ` ${attrs}` : ""}${open?.has(id) ? " open" : ""}><summary>${head}${icon ? `<i class="${esc(icon)}" inert></i>` : ""}<span>${esc(title)}</span></summary><div class="mm-fold-body">${body}</div></details>`;
}

/** Keep `open` (a Set of fold ids) in step with the folds of `host` as they are opened and closed. Returns the cleanup. */
export function keepFolds(host, open) {
  const onToggle = (ev) => { const d = ev.target; if ( d.matches?.(".mm-ws-group[data-fold]") && host.contains(d) ) { if ( d.open ) open.add(d.dataset.fold); else open.delete(d.dataset.fold); } };
  host.addEventListener("toggle", onToggle, true);
  return () => host.removeEventListener("toggle", onToggle, true);
}

/**
 * Dock panels are narrow: the explanation under a Foundry form-group (labels.mjs fg) goes into its label's tooltip instead of a
 * paragraph. The paragraph stays in the DOM, hidden, so the control is still described by it (aria-describedby).
 */
export function tipHints(root) {
  for ( const p of root.querySelectorAll(".form-group > p.hint") ) {
    const label = p.parentElement.querySelector(":scope > label"); if ( !label ) continue;
    label.dataset.tooltip = label.dataset.tooltip ? `${label.dataset.tooltip} ${p.textContent}` : p.textContent;
    p.hidden = true;
  }
}

/**
 * Wire a host's named controls to client settings: `map` = { controlName: settingKey | { key, read(control), write(value, control) } }.
 * A change stores the value; a change of the setting from elsewhere updates the control (unless it has focus). Returns the cleanup.
 * `onInput(name, value)` (optional) previews a value while a slider is being dragged.
 */
export function bindSettings(host, map, { onInput } = {}) {
  const spec = Object.fromEntries(Object.entries(map).map(([n, v]) => [n, typeof v === "string" ? { key: v } : v]));
  const valueOf = (c) => c.matches("input[type=checkbox]") ? c.checked : c.matches("range-picker, input[type=number]") ? Number(c.value) : c.value;
  const onChange = (ev) => {
    if ( isEcho() ) return;
    const c = ev.target.closest?.("[name]"), s = c && spec[c.name]; if ( !s ) return;
    const v = s.read ? s.read(c) : valueOf(c);
    if ( v !== setting(s.key) ) store(s.key, v);
  };
  const onIn = (ev) => {
    if ( isEcho() ) return;
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
      else writeControl(c, v);
    }
  });
  return () => { host.removeEventListener("change", onChange); host.removeEventListener("input", onIn); off(); };
}
