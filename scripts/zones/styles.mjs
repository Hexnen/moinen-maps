import { MODULE_ID } from "../config.mjs";
import { cleanLook } from "./model.mjs";

/**
 * Look presets of the zones: a few built in, more saved by the GM (world setting "zonesStyles"). The world has a default look preset
 * ("zonesStyleDefault") and a default movement preset ("zonesPresetDefault"); each scene follows them unless it picks its own
 * (scene flag: lookFrom = a preset id or "custom" for its own look; preset = a movement preset id). Who sees the zones is never part
 * of a look preset: it stays the scene's own choice.
 */

const T = (k) => `MOINENMAPS.Zones.style.${k}`;
export const BUILTIN = Object.freeze([
  { id: "classic", name: T("classic"), look: {} },
  { id: "subtle", name: T("subtle"), look: { fill: 0.12, ink: 0.7, lineAlpha: 0.55, numbers: "hover", hoverHi: true, hoverFx: "glow", hoverAlpha: 0.8 } },
  { id: "sketch", name: T("sketch"), look: { fill: 0, ink: 1.2, lineAlpha: 0.9, place: "corner", hoverHi: true, hoverFx: "crosshatch" } },
  { id: "bold", name: T("bold"), look: { fill: 0.5, ink: 1.6, hoverHi: true, hoverFx: "dots" } }
]);

const get = (k, d) => { try { return game.settings.get(MODULE_ID, k) ?? d; } catch { return d; } };
const strip = (look) => { const l = cleanLook(look); delete l.who; return l; };

/** The GM's own presets: [{id, name, look}]. */
export function userStyles() {
  const list = get("zonesStyles", { list: [] })?.list;
  return Array.isArray(list) ? list.filter((s) => s && typeof s.id === "string" && typeof s.name === "string") : [];
}

/** Every look preset, names localized: [{id, name, look, builtin}]. */
export function styles() {
  return [
    ...BUILTIN.map((s) => ({ id: s.id, name: game.i18n.localize(s.name), look: strip(s.look), builtin: true })),
    ...userStyles().map((s) => ({ id: s.id, name: s.name, look: strip(s.look), builtin: false }))
  ];
}
export const style = (id) => styles().find((s) => s.id === id) ?? null;

/** The world's default look preset (id) and movement preset (id). */
export const worldStyle = () => { const id = get("zonesStyleDefault", "classic"); return style(id) ? id : "classic"; };
export const worldPreset = () => get("zonesPresetDefault", "invincible");

export async function saveStyle(name, look) {
  const id = `u-${foundry.utils.randomID(8)}`;
  await game.settings.set(MODULE_ID, "zonesStyles", { list: [...userStyles(), { id, name: String(name).trim().slice(0, 60), look: strip(look) }] });
  return id;
}
export async function deleteStyle(id) {
  await game.settings.set(MODULE_ID, "zonesStyles", { list: userStyles().filter((s) => s.id !== id) });
  if ( get("zonesStyleDefault", "classic") === id ) await game.settings.set(MODULE_ID, "zonesStyleDefault", "classic");
}
export const setWorldStyle = (id) => game.settings.set(MODULE_ID, "zonesStyleDefault", style(id) ? id : "classic");
export const setWorldPreset = (id) => game.settings.set(MODULE_ID, "zonesPresetDefault", id);
