export const MODULE_ID = "moinen-maps";

/** Halftone dot fill: size = largest dot diameter as a fraction of the spacing; spacing in grid squares; tint = background wash. */
export const DOT_DEFAULTS = { size: 0.55, spacing: 0.16, angle: 45, useFill: true, color: "#15110f", tint: 0.2, shape: "round", gradient: "none", overprint: false };

export const DEFAULTS = {
  enabled: true,
  color: "#e5322d",
  useNoteTint: true,
  size: 1,
  glyph: "note",       // "note" = note icon inside the pin, "dot" = plain highlight
  shadow: true,
  glow: true,          // glow around the pin on hover / selection
  drop: true,
  dropHeight: 1,
  bounce: 0.55,
  squeeze: 0.5,
  hop: true,           // small hop when a pin is moved
  hoverMode: "saturate",   // districts: none | saturate | highlight
  districtOpacity: 0.8,    // used by districts that carry no opacity of their own
  districtInk: "ink",      // outline colour mode: ink | match | custom
  districtInkColor: "#15110f",
  districtInkOpacity: 0.95,
  districtInkWidth: 1,
  districtListForPlayers: false, // players may open a read-only list of revealed districts
  districtNoBorder: false, // new districts start without an inked outline
  districtNoColor: false, // new districts start without a colour tint
  hoverColor: "#ffd36b",
  hoverStrength: 0.6,
  dots: { ...DOT_DEFAULTS },   // scene default for districts filled with halftone dots
  attrDisplay: "hover",    // district attributes on the map: off | hover | always
  // cosmetic drop animation for tokens placed on this scene (never written to the token document)
  tokens: { enabled: true, who: "all", filter: "all", intensity: 1, dropHeight: 1, bounce: 0.55, squeeze: 0.5, shadow: true, ripple: true, hop: false,
    hide: true,                                                                   // a token hidden / revealed: ghost puff / pop-in
    target: true, reticleStyle: "crosshair", reticleUser: true, reticleColor: "#e5322d", hideNative: false,   // targeting: a hand-inked reticle
    combat: true, combatStagger: true, combatRipple: true, combatNumber: true },    // joining a combat / combat start
  label: { family: "", sizeMode: "fit", size: 36, weight: "700", italic: false, spacing: 3, caseMode: "upper", color: "auto", autoColor: true,
    halo: "#fff3e2", haloWidth: 7, shadow: false, opacity: 1, curved: false, angle: 0, offsetX: 0, offsetY: 0 },   // district label typography
  pinText: { family: "", size: 0, color: "", halo: "", haloWidth: 0 },                  // note tooltip text (0 / "" = Foundry's own)
  idle: "breathe",     // none | breathe | bob | sway | pulse
  idleStrength: 0.5,
  idleSpeed: 1
};

/**
 * Glyph catalogue: every glyph that pin-art.mjs can draw. `icon` is the Foundry core image stored on the note (shown if pins are off
 * for a scene), `fa` is the toolbar / palette icon. Add a drawer in pin-art.mjs and an entry here to offer a new glyph to presets.
 */
export const GLYPHS = {
  star:     { icon: "icons/svg/target.svg",      fa: "fa-location-dot" },
  skull:    { icon: "icons/svg/skull.svg",       fa: "fa-skull" },
  gem:      { icon: "icons/svg/chest.svg",       fa: "fa-gem" },
  bang:     { icon: "icons/svg/mystery-man.svg", fa: "fa-exclamation" },
  tent:     { icon: "icons/svg/fire.svg",        fa: "fa-campground" },
  door:     { icon: "icons/svg/door-closed.svg", fa: "fa-door-open" },
  question: { icon: "icons/svg/hazard.svg",      fa: "fa-question" },
  castle:   { icon: "icons/svg/tower.svg",       fa: "fa-chess-rook" },
  mug:      { icon: "icons/svg/coins.svg",       fa: "fa-beer-mug-empty" },
  sword:    { icon: "icons/svg/sword.svg",       fa: "fa-khanda" },
  tree:     { icon: "icons/svg/pawprint.svg",    fa: "fa-tree" },
  mountain: { icon: "icons/svg/mountain.svg",    fa: "fa-mountain" },
  potion:   { icon: "icons/svg/acid.svg",        fa: "fa-flask" },
  book:     { icon: "icons/svg/book.svg",        fa: "fa-book" },
  house:    { icon: "icons/svg/windmill.svg",    fa: "fa-house" },
  shop:     { icon: "icons/svg/coins.svg",       fa: "fa-shop" },
  cross:    { icon: "icons/svg/first-aid.svg",   fa: "fa-suitcase-medical" },
  badge:    { icon: "icons/svg/shield.svg",      fa: "fa-shield-halved" },
  car:      { icon: "icons/svg/clockwork.svg",   fa: "fa-car" },
  camera:   { icon: "icons/svg/eye.svg",         fa: "fa-camera" },
  triangle: { icon: "icons/svg/hazard.svg",      fa: "fa-triangle-exclamation" },
  cup:      { icon: "icons/svg/small-fire.svg",  fa: "fa-mug-hot" }
};

/**
 * Pin presets: named lists of standalone pin types shown in the pin palette. A type is `{ id, glyph, color, name? }`; a built-in type is
 * named by the lang key MOINENMAPS.Type.<id>, a custom one by `name`. A note remembers only the type id (flags.moinen-maps.pin), so ids
 * must stay unique across every preset and never change. The built-in presets are read-only; custom ones live in the world setting
 * `pinPresets` and are `{ id, name, types }`.
 */
export const BUILTIN_PRESETS = [
  { id: "classic", types: [
    { id: "plain",    glyph: "star",     color: "#e5322d" },
    { id: "danger",   glyph: "skull",    color: "#c8261f" },
    { id: "treasure", glyph: "gem",      color: "#e0a21a" },
    { id: "quest",    glyph: "bang",     color: "#2f86d6" },
    { id: "camp",     glyph: "tent",     color: "#2e9e5b" },
    { id: "door",     glyph: "door",     color: "#8a5a3a" },
    { id: "question", glyph: "question", color: "#8e5bd4" }
  ] },
  { id: "fantasy", types: [
    { id: "fantasy-castle",   glyph: "castle",   color: "#6b6f7a" },
    { id: "fantasy-tavern",   glyph: "mug",      color: "#c97a1a" },
    { id: "fantasy-battle",   glyph: "sword",    color: "#c8261f" },
    { id: "fantasy-forest",   glyph: "tree",     color: "#2e9e5b" },
    { id: "fantasy-mountain", glyph: "mountain", color: "#2f86d6" },
    { id: "fantasy-alchemy",  glyph: "potion",   color: "#8e5bd4" },
    { id: "fantasy-library",  glyph: "book",     color: "#8a5a3a" },
    { id: "fantasy-lair",     glyph: "skull",    color: "#5a2a6e" }
  ] },
  { id: "modern", types: [
    { id: "modern-home",     glyph: "house",    color: "#8a5a3a" },
    { id: "modern-shop",     glyph: "shop",     color: "#e0a21a" },
    { id: "modern-hospital", glyph: "cross",    color: "#e5322d" },
    { id: "modern-police",   glyph: "badge",    color: "#2f86d6" },
    { id: "modern-vehicle",  glyph: "car",      color: "#2e9e5b" },
    { id: "modern-cafe",     glyph: "cup",      color: "#c97a1a" },
    { id: "modern-camera",   glyph: "camera",   color: "#222222" },
    { id: "modern-hazard",   glyph: "triangle", color: "#d8509a" }
  ] }
];
export const DEFAULT_PRESET = "classic";

let customCache = null, typeIndex = null;
/** Drop the cached presets: call when the `pinPresets` setting changes. */
export function resetPresetCache() { customCache = null; typeIndex = null; }

const HEX = /^#[0-9a-f]{6}$/i;
/** Custom presets from the world setting, sanitised so a hand-edited setting can never break the toolbar. */
export function customPresets() {
  if ( customCache ) return customCache;
  let raw = [];
  try { raw = game.settings.get(MODULE_ID, "pinPresets"); } catch { /* settings not registered yet */ }
  const seen = new Set(BUILTIN_PRESETS.flatMap((p) => p.types.map((t) => t.id)));
  customCache = (Array.isArray(raw) ? raw : []).filter((p) => p && typeof p.id === "string" && Array.isArray(p.types)).map((p) => ({
    id: p.id, name: String(p.name ?? ""), custom: true,
    types: p.types.filter((t) => t && typeof t.id === "string" && !seen.has(t.id) && seen.add(t.id)).map((t) => ({
      id: t.id, glyph: GLYPHS[t.glyph] ? t.glyph : "star", color: HEX.test(t.color) ? t.color : "#e5322d", name: String(t.name ?? "")
    }))
  }));
  return customCache;
}
export const allPresets = () => [...BUILTIN_PRESETS, ...customPresets()];

/** A type plus what is derived from its glyph (the note icon and the toolbar icon). */
const resolveType = (t, preset) => ({ ...t, icon: (GLYPHS[t.glyph] ?? GLYPHS.star).icon, fa: (GLYPHS[t.glyph] ?? GLYPHS.star).fa, preset: preset.id });
export const resolvePreset = (p) => ({ ...p, types: p.types.map((t) => resolveType(t, p)) });

/** The display name of a type: a custom name, else its lang key. */
export const typeLabel = (t) => {
  if ( t.name ) return t.name;
  const k = `MOINENMAPS.Type.${t.id}`;
  return game.i18n.localize(game.i18n.has(k) ? k : `MOINENMAPS.Glyph.${t.glyph}`);
};
export const presetLabel = (p) => p.custom ? p.name : game.i18n.localize(`MOINENMAPS.Preset.${p.id}`);

/** Look a pin type up by id across every preset (built-in first). */
export function findPinType(id) {
  if ( !typeIndex ) {
    typeIndex = new Map();
    for ( const p of allPresets() ) for ( const t of p.types ) if ( !typeIndex.has(t.id) ) typeIndex.set(t.id, resolveType(t, p));
  }
  return typeIndex.get(id) ?? null;
}

/** The type of a standalone pin. A pin whose type was deleted from its preset falls back to the first classic type. */
export const pinTypeOf = (doc) => {
  const id = doc?.flags?.[MODULE_ID]?.pin;
  return id ? (findPinType(id) ?? findPinType(BUILTIN_PRESETS[0].types[0].id)) : null;
};

/** Preset colours offered in the colour dialog. */
export const PIN_COLORS = ["#e5322d", "#e0a21a", "#2e9e5b", "#2f86d6", "#8e5bd4", "#d8509a", "#8a5a3a", "#222222"];

export const IDLE_MODES = ["none", "breathe", "bob", "sway", "pulse"];

/**
 * Resolved scene config. Pins and districts read it every frame, so the merge is memoised per scene document and dropped
 * whenever any scene updates. Treat the returned object as read-only (clone before mutating).
 */
let configCache = new WeakMap();
Hooks.on("updateScene", () => { configCache = new WeakMap(); });
Hooks.on("canvasTearDown", () => { configCache = new WeakMap(); });
export function sceneConfig(scene) {
  if ( !scene || typeof scene !== "object" ) return foundry.utils.deepClone(DEFAULTS);
  let c = configCache.get(scene);
  if ( !c ) {
    const f = scene.flags?.[MODULE_ID]?.config ?? {};
    c = foundry.utils.mergeObject(foundry.utils.deepClone(DEFAULTS), f, { inplace: false });
    // resolution order: unsaved draft (Scene Config form) > saved scene config > built-in default
    if ( sceneDraft && sceneDraft.sceneId === scene.id ) c = foundry.utils.mergeObject(c, sceneDraft.data, { inplace: false });
    configCache.set(scene, c);
  }
  return c;
}

/**
 * Unsaved Scene Config form values, laid over the stored config of one scene for a live preview. Never written to the document.
 * `setSceneDraft(null)` discards it. Listeners (pins, districts) are told through the `moinenMapsSceneDraft` hook.
 */
let sceneDraft = null;
export function setSceneDraft(sceneId, data = null) {
  sceneDraft = sceneId && data ? { sceneId, data } : null;
  configCache = new WeakMap();
  Hooks.callAll("moinenMapsSceneDraft");
}

/** True when the OS asks for less motion (Windows "animation effects" off, macOS "reduce motion"). Used for UI niceties such as smooth scrolling. */
const reduceMQ = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
export const osReducedMotion = () => !!reduceMQ?.matches;
const setting = (k, d) => { try { return game.settings.get(MODULE_ID, k); } catch { return d; } };
/**
 * Should the map animations (pins, districts, tokens) stand still? Only when the OS asks for it AND the user opted in with the module setting
 * "Respect reduced motion" (default off). These are gameplay effects, and a system-wide switch must never silently make them vanish.
 */
export const reducedMotion = () => osReducedMotion() && !!setting("respectReducedMotion", false);

/** Debug switch (module setting or CONFIG.debug.moinenMaps): logs why an animation did not play. */
export const debugOn = () => !!(globalThis.CONFIG?.debug?.moinenMaps || setting("debugAnimations", false));
export const dbg = (...a) => { if ( debugOn() ) console.debug("moinen-maps |", ...a); };

export function registerCoreSettings() {
  game.settings.register(MODULE_ID, "respectReducedMotion", { name: "MOINENMAPS.Setting.respectMotion", hint: "MOINENMAPS.Setting.respectMotionHint", scope: "client", config: true, type: Boolean, default: false });
  game.settings.register(MODULE_ID, "debugAnimations", { name: "MOINENMAPS.Setting.debug", hint: "MOINENMAPS.Setting.debugHint", scope: "client", config: true, type: Boolean, default: false });
}
