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
  // a printed field map: tinted zones with a darker ribbon inside each border, cream dashes on a dark casing, board-game counters
  { id: "classic", name: T("classic"), look: { numShape: "counter", hoverHi: true, hoverFx: "glow", hoverAlpha: 0.8 } },
  // quiet: a fine light hairline, a faint shade inside each zone, a small pill with the number only on hover
  { id: "subtle", name: T("subtle"), look: { fill: 0.15, ink: 0.85, lineAlpha: 0.9, lineStyle: "hairline", color: "#f6f1e6", numbers: "hover", numShape: "pill", hoverHi: true, hoverFx: "glow", hoverAlpha: 0.8, hoverLineAlpha: 0.8 } },
  // graphite on the map: wandering pencil passes that overshoot the corners, hand-lettered numbers in scribbled rings, crosshatch on hover
  { id: "sketch", name: T("sketch"), look: { fill: 0, ink: 1.1, lineAlpha: 0.95, lineStyle: "sketch", color: "#2a2a30", place: "corner", numShape: "scribble", hoverHi: true, hoverFx: "crosshatch", hoverAlpha: 0.75, hoverLineAlpha: 0.9 } },
  // a transit map: thick white lines on a black casing, saturated zones, big discs in each zone's own colour
  { id: "bold", name: T("bold"), look: { fill: 0.5, ink: 1.4, lineStyle: "solid", color: "#ffffff", numShape: "disc", hoverHi: true, hoverFx: "dots", hoverAlpha: 0.8 } },
  // comic book panels: wide paper gutters between black panel frames, a yellow caption box in each panel's corner, halftone on hover
  { id: "comic", name: T("comic"), look: { fill: 0.1, ink: 1, lineAlpha: 1, lineStyle: "comic", color: "#fbf6e6", numbers: "always", place: "corner",
    numShape: "caption", numColor: "#15110f", ringColor: "#15110f", numFormat: "arabic", hoverHi: true, hoverFx: "dots", hoverAlpha: 0.75, hoverLineAlpha: 0.9 } },
  // comic 2: halftone dots thick along every panel edge and thinning inwards, paper gutters, big tilted caption boxes
  { id: "comic2", name: T("comic2"), look: { fill: 0.3, ink: 1, lineAlpha: 1, lineStyle: "halftone", color: "#fbf6e6", numbers: "always", place: "corner",
    numShape: "panel", numColor: "#15110f", ringColor: "#15110f", numFormat: "arabic", hoverHi: true, hoverFx: "dots", hoverAlpha: 0.75, hoverLineAlpha: 0.9 } },
  // fantasy: the land aged to parchment, each realm edged with a watercolour ribbon, sepia dash-dot frontiers, heraldic shields
  { id: "fantasy", name: T("fantasy"), look: { fill: 0.3, ink: 1.1, lineAlpha: 0.95, lineStyle: "ink", color: "#3b2414", numbers: "always", place: "center",
    numShape: "shield", numColor: "#3b2414", ringColor: "#6e4a22", numFormat: "roman", hoverHi: true, hoverFx: "crosshatch", hoverAlpha: 0.7, hoverLineAlpha: 0.85 } },
  // cyberpunk: night city HUD - zones sunk in shadow with a neon rim, light tubes with chromatic split and circuit traces, chamfered tags, target lock
  { id: "cyberpunk", name: T("cyberpunk"), look: { fill: 0.4, ink: 1, lineAlpha: 1, lineStyle: "neon", color: "#00f0ff", numbers: "always", place: "corner",
    numShape: "chip", numColor: "#fcee0a", ringColor: "#ff2a6d", numFormat: "padded", hoverHi: true, hoverFx: "scan", hoverAlpha: 0.85, hoverLineAlpha: 1 } },
  // noir: every zone a pool of light in the dark, hard white lines with a long shadow, typed evidence tags with one red mark, light through blinds
  { id: "noir", name: T("noir"), look: { fill: 0.3, ink: 1, lineAlpha: 1, lineStyle: "noir", color: "#f2f2f2", numbers: "always", place: "corner",
    numShape: "tag", numColor: "#111111", ringColor: "#ffffff", numFormat: "arabic", hoverHi: true, hoverFx: "blinds", hoverAlpha: 0.9, hoverLineAlpha: 1 } },
  // sakura: cherry branches for borders with blossoms and buds, a pink haze in each zone, blossom badges, falling petals on hover
  { id: "sakura", name: T("sakura"), look: { fill: 0.25, ink: 1, lineAlpha: 0.95, lineStyle: "sakura", color: "#f7a8c4", numbers: "always", place: "center",
    numShape: "blossom", numColor: "#6b2346", ringColor: "#e07aa0", numFormat: "arabic", hoverHi: true, hoverFx: "petals", hoverAlpha: 0.9, hoverLineAlpha: 0.9 } },
  // sengoku: a gold-leaf folding screen - the map warmed to washi, gold clouds from every border, sumi brush strokes, war banners
  { id: "sengoku", name: T("sengoku"), look: { fill: 0.3, ink: 1.1, lineAlpha: 0.95, lineStyle: "brush", color: "#141010", numbers: "always", place: "center",
    numShape: "banner", numColor: "#fbf1dc", ringColor: "#b3261e", numFormat: "kanji", hoverHi: true, hoverFx: "glow", hoverAlpha: 0.8, hoverLineAlpha: 0.9 } }
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
