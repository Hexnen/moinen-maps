import { MODULE_ID } from "../config.mjs";
import * as U from "./ui-core.mjs";
import { BUILTIN } from "./defs.mjs";

/**
 * DESTRUCTION PRESETS, the UI's stored state (P7):
 *   destrPresets (world)   { v, custom: [definitions], order: [ids] }: the world's own presets (copies of the built-ins, edited) and
 *                          the pads' order (it sets the hotkeys)
 *   presetBar (client)     { pad, size, power, vary, aft: { presetId: seconds | null } }: the armed pad and the bar's controls
 * Both are read only by the Presets tool and its panel; nothing else looks at them.
 */
export const HOOK = "moinenMapsPresetsUi";
export function registerPresetUiSettings() {
  const tell = (what) => () => Hooks.callAll(HOOK, what);
  game.settings.register(MODULE_ID, "destrPresets", { scope: "world", config: false, type: Object, default: { ...U.STORE_DEFAULT }, onChange: tell("store") });
  game.settings.register(MODULE_ID, "presetBar", { scope: "client", config: false, type: Object, default: { ...U.BAR_DEFAULT }, onChange: tell("bar") });
}
const get = (k, d) => { try { return game.settings.get(MODULE_ID, k) ?? d; } catch { return d; } };

export const store = () => U.cleanStore(get("destrPresets", U.STORE_DEFAULT));
export const bar = () => U.cleanBar(get("presetBar", U.BAR_DEFAULT));
export const setBar = (patch) => game.settings.set(MODULE_ID, "presetBar", { ...bar(), ...patch });
export const setStore = (next) => game.settings.set(MODULE_ID, "destrPresets", U.cleanStore(next));

/** Every preset in the pads' order (built-ins as they are, the world's own with `custom`). */
export const pads = () => U.ordered(BUILTIN, store());
export const padById = (id) => pads().find((d) => d.id === id) ?? null;
/** The armed pad (the first one if the armed id is gone). */
export function armed() { const p = pads(), b = bar(); return p.find((d) => d.id === b.pad) ?? p[0] ?? null; }
export const isCustom = (def) => !!def && !BUILTIN.some((b) => b.id === def.id);
/** A preset's name: an i18n key (built-ins) or its own plain name (custom). */
export const nameOf = (def) => (def?.name && game.i18n.has(def.name) ? game.i18n.localize(def.name) : String(def?.name || def?.id || ""));
export const hintOf = (def) => (def?.hint && game.i18n.has(def.hint) ? game.i18n.localize(def.hint) : "");

/** Store a custom preset (replaced by id). */
export async function saveCustom(def) {
  const s = store(), custom = s.custom.filter((d) => d.id !== def.id);
  custom.push(def);
  return setStore({ ...s, custom });
}
export async function deleteCustom(id) {
  const s = store();
  await setStore({ ...s, custom: s.custom.filter((d) => d.id !== id), order: s.order.filter((x) => x !== id) });
  if ( bar().pad === id ) await setBar({ pad: pads()[0]?.id ?? "bomb" });
}
export const setOrder = (ids) => setStore({ ...store(), order: ids });

/* ---------------------------------------------------------------- the shooter (a firearm's source token, this client's choice) */

/** The armed gun's chosen shooter on the open scene: its Token placeable, or null (none chosen, not a gun, or the token is gone). */
export function srcToken(def) {
  const sid = canvas?.scene?.id;
  if ( !sid || !U.isFirearm(def) ) return null;
  const id = U.srcOf(bar(), sid, def.id);
  return (id && canvas.tokens?.get(id)) || null;
}
/** A token as a shooter: its centre and radius (scene px). */
export const shooterOf = (t) => (t ? { id: t.id, x: t.center.x, y: t.center.y, r: Math.max(t.w, t.h) / 2 } : null);
/** Choose (a token id) or clear (null) the shooter of gun `def` on the open scene. */
export function setSrc(def, tokenId) {
  const sid = canvas?.scene?.id;
  if ( !sid || !U.isFirearm(def) ) return null;
  return setBar({ src: U.withSrc(bar(), sid, def.id, tokenId) });
}
