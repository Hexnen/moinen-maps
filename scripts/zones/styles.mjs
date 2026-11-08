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
  { id: "bold", name: T("bold"), look: { fill: 0.5, ink: 1.6, hoverHi: true, hoverFx: "dots" } },
  // comic book panels: wide paper gutters between black panel frames, a yellow caption box in each panel's corner, halftone on hover
  { id: "comic", name: T("comic"), look: { fill: 0.1, ink: 1, lineAlpha: 1, lineStyle: "comic", color: "#fbf6e6", numbers: "always", place: "corner",
    numShape: "caption", numColor: "#15110f", ringColor: "#15110f", numFormat: "arabic", hoverHi: true, hoverFx: "dots", hoverAlpha: 0.75, hoverLineAlpha: 0.9 } },
  // fantasy: a cartographer's sepia ink on parchment, heraldic shields with roman numerals, engraved crosshatching on hover
  { id: "fantasy", name: T("fantasy"), look: { fill: 0.12, ink: 1.1, lineAlpha: 0.95, lineStyle: "ink", color: "#3b2414", numbers: "always", place: "center",
    numShape: "shield", numColor: "#3b2414", ringColor: "#6e4a22", numFormat: "roman", hoverHi: true, hoverFx: "crosshatch", hoverAlpha: 0.7, hoverLineAlpha: 0.85 } },
  // cyberpunk: neon tubes (cyan core in a magenta glow), hexagon badges with zero-padded numbers, a glow on hover
  { id: "cyberpunk", name: T("cyberpunk"), look: { fill: 0.16, ink: 1, lineAlpha: 1, lineStyle: "neon", color: "#29f3ff", numbers: "always", place: "corner",
    numShape: "hex", numColor: "#29f3ff", ringColor: "#ff2bd6", numFormat: "padded", hoverHi: true, hoverFx: "glow", hoverAlpha: 0.9, hoverLineAlpha: 1 } },
  // noir: black and white, hard white lines with a long black shadow, no colour in the zones, venetian-blind stripes on hover
  { id: "noir", name: T("noir"), look: { fill: 0, ink: 1, lineAlpha: 1, lineStyle: "noir", color: "#f2f2f2", numbers: "always", place: "corner",
    numShape: "square", numColor: "#ffffff", ringColor: "#ffffff", numFormat: "arabic", hoverHi: true, hoverFx: "hatch", hoverAlpha: 0.85, hoverLineAlpha: 1 } },
  // sakura: soft pink branches with falling petals along the borders, blossom badges, a gentle glow on hover
  { id: "sakura", name: T("sakura"), look: { fill: 0.1, ink: 1, lineAlpha: 0.95, lineStyle: "sakura", color: "#f7a8c4", numbers: "always", place: "center",
    numShape: "blossom", numColor: "#6b2346", ringColor: "#e07aa0", numFormat: "arabic", hoverHi: true, hoverFx: "glow", hoverAlpha: 0.7, hoverLineAlpha: 0.9 } },
  // sengoku: sumi ink brush strokes on washi, red hanko seals with kanji numerals, ink hatching on hover
  { id: "sengoku", name: T("sengoku"), look: { fill: 0.08, ink: 1.15, lineAlpha: 0.95, lineStyle: "brush", color: "#141010", numbers: "always", place: "corner",
    numShape: "seal", numColor: "#fbf1dc", ringColor: "#b3261e", numFormat: "kanji", hoverHi: true, hoverFx: "hatch", hoverAlpha: 0.6, hoverLineAlpha: 0.85 } }
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
